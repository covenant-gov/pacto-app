<script lang="ts">
  /**
   * Interactive avatar crop step: loads a local image file as a preview, lets the user pan and
   * zoom within a circular crop window, then re-encodes the selected region to a 512x512 JPEG
   * and uploads it. Cancel (Escape, overlay click, or the Cancel button) leaves the caller's
   * avatar untouched.
   */
  import { t } from 'svelte-i18n';
  import Modal from '../ui/Modal.svelte';
  import { getImagePreviewBase64, uploadAvatar } from '../../lib/api/nostr';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';

  export let open: boolean;
  export let filepath: string;
  export let onConfirm: (url: string) => void;
  export let onCancel: () => void;

  const titleId = 'avatar-crop-title';

  /** Upper bound for the interactive crop viewport diameter, CSS px -- the actual rendered size
   * (cropDiameter below) shrinks below this on narrow windows via bind:clientWidth, so all pan/
   * zoom math stays correct regardless of window size. */
  const MAX_CROP_DIAMETER = 280;
  /** Never let the selected crop region span fewer source px than this; also the undersized-warning threshold. */
  const MIN_CROP_SOURCE_PX = 512;
  /** Decoded dimensions beyond this are treated as a decode failure, not a huge-but-real photo. */
  const MAX_PLAUSIBLE_DIMENSION = 20000;
  /** Safety margin under the backend's 500KB cap; a blob over this triggers a quality stepdown re-encode. */
  const MAX_JPEG_BYTES = 400_000;
  const JPEG_QUALITY_FLOOR = 0.3;
  const WHEEL_ZOOM_SENSITIVITY = 0.0015;
  /** Multiplicative zoom change per click of the manual +/- zoom buttons. */
  const ZOOM_BUTTON_FACTOR = 1.2;
  /** CSS px nudged per click of a manual pan direction button. */
  const PAN_STEP_PX = 24;

  let lastOpenedFilepath: string | null = null;
  let loadGeneration = 0;

  let loading = false;
  let previewSrc: string | null = null;
  let decodeError: string | null = null;
  let naturalWidth = 0;
  let naturalHeight = 0;

  let zoom = 1;
  let pan: { x: number; y: number } = { x: 0, y: 0 };
  /** Actual rendered crop-viewport diameter, CSS px -- bound to the element's clientWidth so it
   * tracks CSS (`min(MAX_CROP_DIAMETER, 100%)`) and therefore shrinks on narrow windows. */
  let cropDiameter = MAX_CROP_DIAMETER;

  let uploading = false;
  let uploadError: string | null = null;
  let croppedBytesBase64: string | null = null;

  let imgEl: HTMLImageElement | null = null;
  let dragPointerId: number | null = null;
  let dragStart = { x: 0, y: 0 };
  let panStart = { x: 0, y: 0 };

  $: previewReady = naturalWidth > 0 && naturalHeight > 0;
  $: showUndersizedWarning = previewReady && cropDiameter / zoom < MIN_CROP_SOURCE_PX;
  // Available pan travel per axis at the current zoom -- 0 whenever that axis is already flush
  // with the crop circle (e.g. the tight axis of a landscape/portrait photo at cover-fit zoom).
  $: maxPanX = previewReady ? Math.max(naturalWidth * zoom - cropDiameter, 0) / 2 : 0;
  $: maxPanY = previewReady ? Math.max(naturalHeight * zoom - cropDiameter, 0) / 2 : 0;
  // Re-clamp whenever cropDiameter changes (window resized while the modal is open) so zoom/pan
  // never go stale against the new viewport size; idempotent once already in range, so this
  // settles in one pass rather than looping.
  $: if (previewReady) {
    zoom = clampZoom(zoom, naturalWidth, naturalHeight, cropDiameter);
  }
  $: if (previewReady) {
    pan = clampPan(pan, zoom, naturalWidth, naturalHeight, cropDiameter);
  }
  // A direction button is only enabled while there's room left to move that way -- disabled
  // (not silently inert) once the image edge is already flush with the crop circle.
  $: canPanUp = maxPanY > 0.5 && pan.y < maxPanY - 0.5;
  $: canPanDown = maxPanY > 0.5 && pan.y > -maxPanY + 0.5;
  $: canPanLeft = maxPanX > 0.5 && pan.x < maxPanX - 0.5;
  $: canPanRight = maxPanX > 0.5 && pan.x > -maxPanX + 0.5;

  // Fires once per open-transition (or when filepath changes while already open), not on every
  // unrelated reactive re-run: lastOpenedFilepath guards against reloading the preview or wiping
  // in-progress pan/zoom state whenever this block re-evaluates for unrelated reasons.
  $: if (open && filepath) {
    if (filepath !== lastOpenedFilepath) {
      lastOpenedFilepath = filepath;
      beginPreviewLoad(filepath);
    }
  } else if (!open && lastOpenedFilepath !== null) {
    lastOpenedFilepath = null;
  }

  function resetCropState() {
    loading = true;
    previewSrc = null;
    decodeError = null;
    naturalWidth = 0;
    naturalHeight = 0;
    zoom = 1;
    pan = { x: 0, y: 0 };
    uploading = false;
    uploadError = null;
    croppedBytesBase64 = null;
  }

  function beginPreviewLoad(path: string) {
    resetCropState();
    const gen = ++loadGeneration;
    getImagePreviewBase64(path, 100)
      .then((dataUri) => {
        if (gen !== loadGeneration) return;
        loading = false;
        previewSrc = dataUri;
      })
      .catch((e) => {
        if (gen !== loadGeneration) return;
        loading = false;
        decodeError = getInvokeErrorMessage(e, $t('profile.crop.decodeError'));
      });
  }

  function isPlausibleDimensions(w: number, h: number): boolean {
    return w > 0 && h > 0 && w <= MAX_PLAUSIBLE_DIMENSION && h <= MAX_PLAUSIBLE_DIMENSION;
  }

  function handlePreviewImgLoad() {
    if (!imgEl) return;
    const w = imgEl.naturalWidth;
    const h = imgEl.naturalHeight;
    if (!isPlausibleDimensions(w, h)) {
      previewSrc = null;
      decodeError = $t('profile.crop.decodeError');
      return;
    }
    naturalWidth = w;
    naturalHeight = h;
    const initialZoom = coverFitZoom(w, h, cropDiameter);
    zoom = initialZoom;
    pan = clampPan({ x: 0, y: 0 }, initialZoom, w, h, cropDiameter);
  }

  function handlePreviewImgError() {
    previewSrc = null;
    decodeError = $t('profile.crop.decodeError');
  }

  /** Zoom (CSS px per source px) at which the image just fully covers the circular crop. */
  function coverFitZoom(width: number, height: number, diameter: number): number {
    if (width <= 0 || height <= 0) return 1;
    return Math.max(diameter / width, diameter / height);
  }

  function computeMaxZoom(width: number, height: number, diameter: number): number {
    const minZ = coverFitZoom(width, height, diameter);
    const sourceFloorZoom = diameter / MIN_CROP_SOURCE_PX;
    // A source image smaller than the floor can't be over-zoomed past its own cover-fit; the
    // undersized warning (not this clamp) is what tells the user their source is small.
    return Math.max(sourceFloorZoom, minZ);
  }

  function clampZoom(z: number, width: number, height: number, diameter: number): number {
    const minZ = coverFitZoom(width, height, diameter);
    const maxZ = computeMaxZoom(width, height, diameter);
    return Math.min(Math.max(z, minZ), maxZ);
  }

  function clampPan(
    p: { x: number; y: number },
    z: number,
    width: number,
    height: number,
    diameter: number
  ): { x: number; y: number } {
    const slackX = width * z - diameter;
    const slackY = height * z - diameter;
    const maxX = slackX > 0 ? slackX / 2 : 0;
    const maxY = slackY > 0 ? slackY / 2 : 0;
    return {
      x: Math.min(Math.max(p.x, -maxX), maxX),
      y: Math.min(Math.max(p.y, -maxY), maxY),
    };
  }

  /** Manual-control equivalent of the wheel-zoom gesture, for the visible +/- buttons. */
  function zoomByFactor(factor: number) {
    if (uploading || !naturalWidth || !naturalHeight) return;
    const nextZoom = clampZoom(zoom * factor, naturalWidth, naturalHeight, cropDiameter);
    zoom = nextZoom;
    pan = clampPan(pan, nextZoom, naturalWidth, naturalHeight, cropDiameter);
    croppedBytesBase64 = null;
    uploadError = null;
  }

  /** Manual-control equivalent for the visible zoom slider (absolute value, not a step). */
  function setZoomValue(value: number) {
    if (uploading || !naturalWidth || !naturalHeight) return;
    const nextZoom = clampZoom(value, naturalWidth, naturalHeight, cropDiameter);
    zoom = nextZoom;
    pan = clampPan(pan, nextZoom, naturalWidth, naturalHeight, cropDiameter);
    croppedBytesBase64 = null;
    uploadError = null;
  }

  /** Manual-control equivalent of pointer-drag panning, for the visible direction buttons. */
  function panByStep(dx: number, dy: number) {
    if (uploading || !naturalWidth || !naturalHeight) return;
    pan = clampPan({ x: pan.x + dx, y: pan.y + dy }, zoom, naturalWidth, naturalHeight, cropDiameter);
    croppedBytesBase64 = null;
    uploadError = null;
  }

  function handleWheel(e: WheelEvent) {
    if (uploading || !naturalWidth || !naturalHeight) return;
    e.preventDefault();
    // Zoom on every wheel/trackpad event rather than gating on ctrlKey: trackpad pinch reports as
    // wheel+ctrlKey in most browsers, but plain mouse-wheel scroll over this viewport has nothing
    // else to do, so treating all wheel input as zoom keeps the gesture reliable across devices.
    const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
    const nextZoom = clampZoom(zoom * factor, naturalWidth, naturalHeight, cropDiameter);
    zoom = nextZoom;
    pan = clampPan(pan, nextZoom, naturalWidth, naturalHeight, cropDiameter);
    croppedBytesBase64 = null;
    uploadError = null;
  }

  function handlePointerDown(e: PointerEvent) {
    if (uploading || !naturalWidth || !naturalHeight) return;
    dragPointerId = e.pointerId;
    dragStart = { x: e.clientX, y: e.clientY };
    panStart = { ...pan };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // best-effort; dragging still works without capture on browsers that reject it here
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (dragPointerId === null || e.pointerId !== dragPointerId) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    pan = clampPan(
      { x: panStart.x + dx, y: panStart.y + dy },
      zoom,
      naturalWidth,
      naturalHeight,
      cropDiameter
    );
    croppedBytesBase64 = null;
    uploadError = null;
  }

  function handlePointerUp(e: PointerEvent) {
    if (dragPointerId === null || e.pointerId !== dragPointerId) return;
    dragPointerId = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  }

  /** Inverse of the on-screen pan/zoom transform: the crop circle's source-space rectangle. */
  function computeCropSourceRect(): { sx: number; sy: number; sSize: number } {
    const sSize = cropDiameter / zoom;
    const sx = naturalWidth / 2 - pan.x / zoom - sSize / 2;
    const sy = naturalHeight / 2 - pan.y / zoom - sSize / 2;
    return { sx, sy, sSize };
  }

  function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  }

  async function encodeCanvasUnderBudget(canvas: HTMLCanvasElement): Promise<Blob> {
    const qualitySteps = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35, JPEG_QUALITY_FLOOR];
    let best: Blob | null = null;
    for (const quality of qualitySteps) {
      const blob = await canvasToJpegBlob(canvas, quality);
      if (!blob) continue;
      best = blob;
      if (blob.size <= MAX_JPEG_BYTES || quality <= JPEG_QUALITY_FLOOR) break;
    }
    if (!best) throw new Error('Failed to encode the cropped image');
    return best;
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('Unexpected FileReader result'));
          return;
        }
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  }

  async function cropToBase64Jpeg(): Promise<string> {
    if (!imgEl || !naturalWidth || !naturalHeight) {
      throw new Error('Preview image is not ready');
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable');

    // Fill white first: a transparent PNG/GIF/WEBP source shouldn't leave transparency baked
    // into the JPEG output (JPEG has no alpha channel).
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 512, 512);

    const { sx, sy, sSize } = computeCropSourceRect();
    ctx.drawImage(imgEl, sx, sy, sSize, sSize, 0, 0, 512, 512);

    const blob = await encodeCanvasUnderBudget(canvas);
    return blobToBase64(blob);
  }

  async function handleConfirm() {
    if (uploading || !previewReady) return;

    // showUndersizedWarning is a reactive value derived from zoom (see the $: declaration
    // above); Svelte recomputes it synchronously on every zoom/pan change, so it is already
    // current here — no separate re-check needed at confirm time (R10).

    uploadError = null;
    try {
      if (!croppedBytesBase64) {
        croppedBytesBase64 = await cropToBase64Jpeg();
      }
    } catch (e) {
      uploadError = getInvokeErrorMessage(e, $t('profile.crop.uploadError'));
      return;
    }

    uploading = true;
    try {
      const url = await uploadAvatar(croppedBytesBase64, 'avatar');
      uploading = false;
      onConfirm(url);
    } catch (e) {
      uploading = false;
      uploadError = getInvokeErrorMessage(e, $t('profile.crop.uploadError'));
    }
  }

  function handleCancel() {
    onCancel();
  }
</script>

{#if open}
  <Modal {titleId} onClose={handleCancel} dismissible={!uploading} contentClass="avatar-crop-modal">
    <h2 id={titleId}>{$t('profile.crop.title')}</h2>

    {#if loading}
      <div class="crop-loading" role="status">
        <div class="spinner"></div>
        <p>{$t('profile.crop.loadingPreview')}</p>
      </div>
    {:else if decodeError}
      <div class="crop-alert" role="alert">
        <p>{decodeError}</p>
        <!--
          This button only calls onCancel() — it can't itself relaunch the native file picker
          across this component's prop boundary. The caller must treat onCancel as safe to invoke
          from this decode-error path too (not only from Escape, overlay click, or the explicit
          Cancel button) so the user can pick a different file afterward.
        -->
        <button type="button" class="btn-secondary" on:click={handleCancel}>
          {$t('profile.crop.chooseDifferentImage')}
        </button>
      </div>
    {:else if previewSrc}
      {#if !previewReady}
        <div class="crop-loading" role="status">
          <div class="spinner"></div>
          <p>{$t('profile.crop.loadingPreview')}</p>
        </div>
      {/if}

      <div
        class="crop-viewport"
        class:crop-viewport-pending={!previewReady}
        role="application"
        aria-label={$t('profile.crop.hint')}
        bind:clientWidth={cropDiameter}
        on:wheel|nonpassive={handleWheel}
        on:pointerdown={handlePointerDown}
        on:pointermove={handlePointerMove}
        on:pointerup={handlePointerUp}
        on:pointercancel={handlePointerUp}
      >
        <img
          bind:this={imgEl}
          src={previewSrc}
          alt=""
          class="crop-image"
          style="width: {naturalWidth * zoom}px; height: {naturalHeight * zoom}px; transform: translate(calc(-50% + {pan.x}px), calc(-50% + {pan.y}px));"
          on:load={handlePreviewImgLoad}
          on:error={handlePreviewImgError}
          draggable="false"
        />
      </div>

      {#if previewReady}
        <p class="crop-hint">{$t('profile.crop.hint')}</p>

        <div class="crop-manual-controls">
          <div class="crop-zoom-controls">
            <button
              type="button"
              class="crop-step-btn"
              on:click={() => zoomByFactor(1 / ZOOM_BUTTON_FACTOR)}
              disabled={uploading}
              aria-label={$t('profile.crop.zoomOut')}
            >
              &minus;
            </button>
            <input
              type="range"
              class="crop-zoom-slider"
              min={coverFitZoom(naturalWidth, naturalHeight, cropDiameter)}
              max={computeMaxZoom(naturalWidth, naturalHeight, cropDiameter)}
              step={(computeMaxZoom(naturalWidth, naturalHeight, cropDiameter) -
                coverFitZoom(naturalWidth, naturalHeight, cropDiameter)) /
                100 || 0.001}
              value={zoom}
              on:input={(e) => setZoomValue(Number(e.currentTarget.value))}
              disabled={uploading}
              aria-label={$t('profile.crop.zoomSlider')}
            />
            <button
              type="button"
              class="crop-step-btn"
              on:click={() => zoomByFactor(ZOOM_BUTTON_FACTOR)}
              disabled={uploading}
              aria-label={$t('profile.crop.zoomIn')}
            >
              +
            </button>
          </div>

          <div class="crop-pan-controls" role="group" aria-label={$t('profile.crop.panControls')}>
            <button
              type="button"
              class="crop-step-btn crop-pan-btn crop-pan-btn-up"
              on:click={() => panByStep(0, PAN_STEP_PX)}
              disabled={uploading || !canPanUp}
              aria-label={$t('profile.crop.panUp')}
            >
              &uarr;
            </button>
            <button
              type="button"
              class="crop-step-btn crop-pan-btn crop-pan-btn-left"
              on:click={() => panByStep(PAN_STEP_PX, 0)}
              disabled={uploading || !canPanLeft}
              aria-label={$t('profile.crop.panLeft')}
            >
              &larr;
            </button>
            <button
              type="button"
              class="crop-step-btn crop-pan-btn crop-pan-btn-right"
              on:click={() => panByStep(-PAN_STEP_PX, 0)}
              disabled={uploading || !canPanRight}
              aria-label={$t('profile.crop.panRight')}
            >
              &rarr;
            </button>
            <button
              type="button"
              class="crop-step-btn crop-pan-btn crop-pan-btn-down"
              on:click={() => panByStep(0, -PAN_STEP_PX)}
              disabled={uploading || !canPanDown}
              aria-label={$t('profile.crop.panDown')}
            >
              &darr;
            </button>
          </div>
        </div>

        {#if showUndersizedWarning}
          <p class="crop-warning" role="status">{$t('profile.crop.undersizedWarning')}</p>
        {/if}

        {#if uploadError}
          <div class="crop-alert" role="alert">{uploadError}</div>
        {/if}

        <div class="modal-actions">
          <button type="button" class="btn-secondary" on:click={handleCancel} disabled={uploading}>
            {$t('profile.cancel')}
          </button>
          <button type="button" class="btn-primary" on:click={handleConfirm} disabled={uploading}>
            {uploading ? $t('profile.uploading') : uploadError ? $t('profile.crop.retry') : $t('profile.crop.confirm')}
          </button>
        </div>
      {/if}
    {/if}
  </Modal>
{/if}

<style>
  :global(.avatar-crop-modal) {
    max-width: 400px;
  }

  .crop-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    color: var(--text-muted);
    gap: 12px;
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid var(--border-subtle);
    border-top-color: var(--brand);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .crop-viewport {
    position: relative;
    /* Responsive: shrinks below MAX_CROP_DIAMETER (280px) on narrow windows; cropDiameter
       (bound via clientWidth) tracks whatever this resolves to, so pan/zoom math stays correct. */
    width: min(280px, 100%);
    aspect-ratio: 1;
    margin: 0 auto;
    border-radius: 50%;
    overflow: hidden;
    background: #000;
    cursor: grab;
    touch-action: none;
    /* box-shadow (not border) keeps this element's box model exactly cropDiameter regardless of
       box-sizing, since the pan/zoom math assumes the clipped content area is exactly that size. */
    box-shadow: 0 0 0 4px var(--border-subtle);
  }

  .crop-viewport:active {
    cursor: grabbing;
  }

  .crop-viewport-pending {
    /* Not display:none: that would zero out clientWidth and break the cropDiameter binding
       while the preview is still loading. visibility:hidden keeps layout (and measurement)
       intact while hiding the not-yet-sized image from view. */
    visibility: hidden;
  }

  .crop-image {
    position: absolute;
    top: 50%;
    left: 50%;
    max-width: none;
    user-select: none;
    pointer-events: none;
  }

  .crop-hint {
    margin: 12px 0 0 0;
    text-align: center;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .crop-manual-controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-top: 14px;
  }

  .crop-zoom-controls {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
  }

  .crop-zoom-slider {
    flex: 1;
    accent-color: var(--brand);
  }

  .crop-step-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }

  .crop-step-btn:hover:not(:disabled) {
    border-color: var(--text-muted);
  }

  .crop-step-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .crop-pan-controls {
    display: grid;
    grid-template-columns: repeat(3, 32px);
    grid-template-rows: repeat(3, 32px);
    gap: 4px;
  }

  .crop-pan-btn-up {
    grid-column: 2;
    grid-row: 1;
  }

  .crop-pan-btn-left {
    grid-column: 1;
    grid-row: 2;
  }

  .crop-pan-btn-right {
    grid-column: 3;
    grid-row: 2;
  }

  .crop-pan-btn-down {
    grid-column: 2;
    grid-row: 3;
  }

  .crop-warning {
    margin: 16px 0 0 0;
    padding: 12px 14px;
    border-radius: 8px;
    border-left: 3px solid var(--warning);
    background: rgba(250, 166, 26, 0.1);
    color: var(--warning);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  .crop-alert {
    margin: 16px 0 0 0;
    padding: 12px 14px;
    border-radius: 8px;
    background: rgba(242, 63, 66, 0.1);
    color: var(--danger);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  .crop-alert p {
    margin: 0 0 10px 0;
  }
</style>
