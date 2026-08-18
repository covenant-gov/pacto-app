<script lang="ts">
  /** Circular crop → 512×512 JPEG → Blossom `upload_avatar`. */
  import { t } from 'svelte-i18n';
  import Modal from './Modal.svelte';
  import { getImagePreviewBase64, uploadAvatar } from '../../lib/api/nostr';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';

  let {
    open,
    filepath,
    title,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    filepath: string;
    title: string;
    onConfirm: (url: string) => void;
    onCancel: () => void;
  } = $props();

  const titleId = 'avatar-crop-title';
  const MAX_CROP_DIAMETER = 280;
  const MIN_CROP_SOURCE_PX = 512;
  const MAX_PLAUSIBLE_DIMENSION = 20000;
  const MAX_JPEG_BYTES = 400_000;
  const JPEG_QUALITY_FLOOR = 0.3;
  const WHEEL_ZOOM_SENSITIVITY = 0.0015;
  const ZOOM_BUTTON_FACTOR = 1.2;
  const PAN_STEP_PX = 24;

  let lastOpenedFilepath = $state<string | null>(null);
  let loadGeneration = $state(0);
  let loading = $state(false);
  let previewSrc = $state<string | null>(null);
  let decodeError = $state<string | null>(null);
  let naturalWidth = $state(0);
  let naturalHeight = $state(0);
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let cropDiameter = $state(MAX_CROP_DIAMETER);
  let uploading = $state(false);
  let uploadError = $state<string | null>(null);
  let croppedBytesBase64 = $state<string | null>(null);
  let imgEl = $state<HTMLImageElement | null>(null);
  let viewportEl = $state<HTMLDivElement | null>(null);
  let dragPointerId = $state<number | null>(null);
  let dragStart = $state({ x: 0, y: 0 });
  let panStart = $state({ x: 0, y: 0 });

  const previewReady = $derived(naturalWidth > 0 && naturalHeight > 0);
  const showUndersizedWarning = $derived(
    previewReady && cropDiameter / zoom < MIN_CROP_SOURCE_PX,
  );
  const maxPanX = $derived(
    previewReady ? Math.max(naturalWidth * zoom - cropDiameter, 0) / 2 : 0,
  );
  const maxPanY = $derived(
    previewReady ? Math.max(naturalHeight * zoom - cropDiameter, 0) / 2 : 0,
  );
  const canPanUp = $derived(maxPanY > 0.5 && pan.y < maxPanY - 0.5);
  const canPanDown = $derived(maxPanY > 0.5 && pan.y > -maxPanY + 0.5);
  const canPanLeft = $derived(maxPanX > 0.5 && pan.x < maxPanX - 0.5);
  const canPanRight = $derived(maxPanX > 0.5 && pan.x > -maxPanX + 0.5);

  $effect(() => {
    if (open && filepath) {
      if (filepath !== lastOpenedFilepath) {
        lastOpenedFilepath = filepath;
        beginPreviewLoad(filepath);
      }
    } else if (!open && lastOpenedFilepath !== null) {
      lastOpenedFilepath = null;
    }
  });

  $effect(() => {
    if (!previewReady) return;
    const nextZoom = clampZoom(zoom, naturalWidth, naturalHeight, cropDiameter);
    const nextPan = clampPan(pan, nextZoom, naturalWidth, naturalHeight, cropDiameter);
    if (nextZoom !== zoom) zoom = nextZoom;
    if (nextPan.x !== pan.x || nextPan.y !== pan.y) pan = nextPan;
  });

  $effect(() => {
    const el = viewportEl;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      handleWheel(e);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

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
        decodeError = getInvokeErrorMessage(e, $t('media.avatarCrop.decodeError'));
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
      decodeError = $t('media.avatarCrop.decodeError');
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
    decodeError = $t('media.avatarCrop.decodeError');
  }

  function coverFitZoom(width: number, height: number, diameter: number): number {
    if (width <= 0 || height <= 0) return 1;
    return Math.max(diameter / width, diameter / height);
  }

  function computeMaxZoom(width: number, height: number, diameter: number): number {
    const minZ = coverFitZoom(width, height, diameter);
    const sourceFloorZoom = diameter / MIN_CROP_SOURCE_PX;
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
    diameter: number,
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

  function zoomByFactor(factor: number) {
    if (uploading || !naturalWidth || !naturalHeight) return;
    const nextZoom = clampZoom(zoom * factor, naturalWidth, naturalHeight, cropDiameter);
    zoom = nextZoom;
    pan = clampPan(pan, nextZoom, naturalWidth, naturalHeight, cropDiameter);
    croppedBytesBase64 = null;
    uploadError = null;
  }

  function setZoomValue(value: number) {
    if (uploading || !naturalWidth || !naturalHeight) return;
    const nextZoom = clampZoom(value, naturalWidth, naturalHeight, cropDiameter);
    zoom = nextZoom;
    pan = clampPan(pan, nextZoom, naturalWidth, naturalHeight, cropDiameter);
    croppedBytesBase64 = null;
    uploadError = null;
  }

  function panByStep(dx: number, dy: number) {
    if (uploading || !naturalWidth || !naturalHeight) return;
    pan = clampPan({ x: pan.x + dx, y: pan.y + dy }, zoom, naturalWidth, naturalHeight, cropDiameter);
    croppedBytesBase64 = null;
    uploadError = null;
  }

  function handleWheel(e: WheelEvent) {
    if (uploading || !naturalWidth || !naturalHeight) return;
    e.preventDefault();
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
      /* capture optional */
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
      cropDiameter,
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
      /* already released */
    }
  }

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
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 512, 512);
    const { sx, sy, sSize } = computeCropSourceRect();
    ctx.drawImage(imgEl, sx, sy, sSize, sSize, 0, 0, 512, 512);
    const blob = await encodeCanvasUnderBudget(canvas);
    return blobToBase64(blob);
  }

  async function handleConfirm() {
    if (uploading || !previewReady) return;
    uploadError = null;
    try {
      if (!croppedBytesBase64) {
        croppedBytesBase64 = await cropToBase64Jpeg();
      }
    } catch (e) {
      uploadError = getInvokeErrorMessage(e, $t('media.avatarCrop.uploadError'));
      return;
    }
    uploading = true;
    try {
      const url = await uploadAvatar(croppedBytesBase64, 'avatar');
      uploading = false;
      onConfirm(url);
    } catch (e) {
      uploading = false;
      uploadError = getInvokeErrorMessage(e, $t('media.avatarCrop.uploadError'));
    }
  }

  function handleCancel() {
    onCancel();
  }
</script>

{#if open}
  <Modal {titleId} onClose={handleCancel} dismissible={!uploading} contentClass="avatar-crop-modal">
    <h2 id={titleId}>{title}</h2>

    {#if loading}
      <div class="crop-loading" role="status">
        <div class="spinner"></div>
        <p>{$t('media.avatarCrop.loadingPreview')}</p>
      </div>
    {:else if decodeError}
      <div class="crop-alert" role="alert">
        <p>{decodeError}</p>
        <button type="button" class="btn-secondary" onclick={handleCancel}>
          {$t('media.avatarCrop.chooseDifferentImage')}
        </button>
      </div>
    {:else if previewSrc}
      {#if !previewReady}
        <div class="crop-loading" role="status">
          <div class="spinner"></div>
          <p>{$t('media.avatarCrop.loadingPreview')}</p>
        </div>
      {/if}

      <div
        bind:this={viewportEl}
        class="crop-viewport"
        class:crop-viewport-pending={!previewReady}
        role="application"
        aria-label={$t('media.avatarCrop.hint')}
        bind:clientWidth={cropDiameter}
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerUp}
      >
        <img
          bind:this={imgEl}
          src={previewSrc}
          alt=""
          class="crop-image"
          style="width: {naturalWidth * zoom}px; height: {naturalHeight * zoom}px; transform: translate(calc(-50% + {pan.x}px), calc(-50% + {pan.y}px));"
          onload={handlePreviewImgLoad}
          onerror={handlePreviewImgError}
          draggable="false"
        />
      </div>

      {#if previewReady}
        <p class="crop-hint">{$t('media.avatarCrop.hint')}</p>

        <div class="crop-manual-controls">
          <div class="crop-zoom-controls">
            <button
              type="button"
              class="crop-step-btn"
              onclick={() => zoomByFactor(1 / ZOOM_BUTTON_FACTOR)}
              disabled={uploading}
              aria-label={$t('media.avatarCrop.zoomOut')}
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
              oninput={(e) => setZoomValue(Number(e.currentTarget.value))}
              disabled={uploading}
              aria-label={$t('media.avatarCrop.zoomSlider')}
            />
            <button
              type="button"
              class="crop-step-btn"
              onclick={() => zoomByFactor(ZOOM_BUTTON_FACTOR)}
              disabled={uploading}
              aria-label={$t('media.avatarCrop.zoomIn')}
            >
              +
            </button>
          </div>

          <div class="crop-pan-controls" role="group" aria-label={$t('media.avatarCrop.panControls')}>
            <button
              type="button"
              class="crop-step-btn crop-pan-btn crop-pan-btn-up"
              onclick={() => panByStep(0, PAN_STEP_PX)}
              disabled={uploading || !canPanUp}
              aria-label={$t('media.avatarCrop.panUp')}
            >
              &uarr;
            </button>
            <button
              type="button"
              class="crop-step-btn crop-pan-btn crop-pan-btn-left"
              onclick={() => panByStep(PAN_STEP_PX, 0)}
              disabled={uploading || !canPanLeft}
              aria-label={$t('media.avatarCrop.panLeft')}
            >
              &larr;
            </button>
            <button
              type="button"
              class="crop-step-btn crop-pan-btn crop-pan-btn-right"
              onclick={() => panByStep(-PAN_STEP_PX, 0)}
              disabled={uploading || !canPanRight}
              aria-label={$t('media.avatarCrop.panRight')}
            >
              &rarr;
            </button>
            <button
              type="button"
              class="crop-step-btn crop-pan-btn crop-pan-btn-down"
              onclick={() => panByStep(0, -PAN_STEP_PX)}
              disabled={uploading || !canPanDown}
              aria-label={$t('media.avatarCrop.panDown')}
            >
              &darr;
            </button>
          </div>
        </div>

        {#if showUndersizedWarning}
          <p class="crop-warning" role="status">{$t('media.avatarCrop.undersizedWarning')}</p>
        {/if}

        {#if uploadError}
          <div class="crop-alert" role="alert">{uploadError}</div>
        {/if}

        <div class="modal-actions">
          <button type="button" class="btn-secondary" onclick={handleCancel} disabled={uploading}>
            {$t('media.avatarCrop.cancel')}
          </button>
          <button type="button" class="btn-primary" onclick={() => void handleConfirm()} disabled={uploading}>
            {uploading
              ? $t('media.avatarCrop.uploading')
              : uploadError
                ? $t('media.avatarCrop.retry')
                : $t('media.avatarCrop.confirm')}
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
    width: min(280px, 100%);
    aspect-ratio: 1;
    margin: 0 auto;
    border-radius: 50%;
    overflow: hidden;
    background: #000;
    cursor: grab;
    touch-action: none;
    box-shadow: 0 0 0 4px var(--border-subtle);
  }

  .crop-viewport:active {
    cursor: grabbing;
  }

  .crop-viewport-pending {
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
