<script lang="ts">
  import { t } from 'svelte-i18n';
  import { onDestroy, createEventDispatcher } from 'svelte';
  import { revealInFolder, canRevealInFolder } from '../../lib/utils/reveal-in-folder';
  import { formatMessageTimestamp } from '../../lib/utils/message-formatting';
  import { saveAttachmentAs } from '../../lib/api/nostr';
  import { showToast } from '../../stores/toast';
  import xIcon from '../../icons/x.svg';
  import rotateIcon from '../../icons/rotate.svg';
  import downloadIcon from '../../icons/download.svg';

  export let open = false;
  export let src: string | undefined = undefined;
  export let alt = '';
  export let localPath: string | undefined = undefined;
  /** Sender identity for the bottom-left bar; omitted entirely when no author name is given. */
  export let authorName: string | undefined = undefined;
  export let avatarSrc: string | undefined = undefined;
  export let timestamp: string | undefined = undefined;
  /** Needed for the download/save-as control and the "Show Message" menu action. */
  export let chatId: string | undefined = undefined;
  export let messageId: string | undefined = undefined;
  export let attachmentId: string | undefined = undefined;

  const dispatch = createEventDispatcher<{ showMessage: { messageId: string } }>();

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let rotation = 0;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startTranslateX = 0;
  let startTranslateY = 0;
  let backdropEl: HTMLDivElement | undefined;
  let menuOpen = false;
  let menuWrapperEl: HTMLDivElement | undefined;
  let savingAs = false;

  $: if (!open) resetView();

  function resetView() {
    scale = 1;
    translateX = 0;
    translateY = 0;
    rotation = 0;
    dragging = false;
    menuOpen = false;
  }

  function close() {
    open = false;
  }

  function zoomIn() {
    scale = Math.min(scale + 0.25, 5);
  }

  function zoomOut() {
    scale = Math.max(scale - 0.25, 0.5);
  }

  function rotateImage() {
    rotation = (rotation + 90) % 360;
  }

  function handleWheel(event: WheelEvent) {
    event.preventDefault();
    const delta = -event.deltaY * 0.001;
    scale = Math.min(Math.max(scale + delta, 0.5), 5);
  }

  function handleKey(event: KeyboardEvent) {
    if (!open || event.key !== 'Escape') return;
    if (menuOpen) {
      closeMenu();
    } else {
      close();
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === backdropEl) {
      close();
    }
  }

  function handleBackdropKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      close();
    }
  }

  function handlePointerDown(event: PointerEvent) {
    if (!open) return;
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    startTranslateX = translateX;
    startTranslateY = translateY;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragging) return;
    translateX = startTranslateX + (event.clientX - startX);
    translateY = startTranslateY + (event.clientY - startY);
  }

  function handlePointerUp() {
    dragging = false;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  }

  onDestroy(() => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  });

  async function handleReveal() {
    if (!localPath) return;
    try {
      await revealInFolder(localPath);
    } catch (e) {
      console.error('Could not reveal file', e);
    }
  }

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (!menuOpen) return;
    const target = event.target as Node | null;
    if (target && menuWrapperEl?.contains(target)) return;
    closeMenu();
  }

  function handleRevealFromMenu() {
    closeMenu();
    void handleReveal();
  }

  /** Closes the viewer and asks the caller to scroll to/highlight this image's source message. */
  function handleShowMessage() {
    closeMenu();
    if (messageId) dispatch('showMessage', { messageId });
    close();
  }

  /** Copies the (already downloaded + decrypted) image to a destination chosen via native dialog. */
  async function handleDownload() {
    if (savingAs || !chatId || !messageId || !attachmentId) return;
    if (typeof window === 'undefined' || !(window as Window & { __TAURI__?: unknown }).__TAURI__) return;
    savingAs = true;
    try {
      const savedPath = await saveAttachmentAs(chatId, messageId, attachmentId);
      if (!savedPath) return;
      showToast($t('messaging.attachment.saved', { values: { path: savedPath } }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : $t('messaging.attachment.saveFailed'), undefined, undefined, {
        error: true,
      });
    } finally {
      savingAs = false;
    }
  }
</script>

<svelte:window on:keydown={handleKey} on:pointerdown={handleWindowPointerDown} />

{#if open}
  <div
    class="image-viewer-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Image viewer"
    tabindex="-1"
    bind:this={backdropEl}
    on:click={handleBackdropClick}
    on:keydown={handleBackdropKey}
  >
    <button
      type="button"
      class="viewer-close"
      on:click|stopPropagation={close}
      aria-label="Close image viewer"
      title={$t('messaging.imageViewer.close')}
    >
      <img src={xIcon} alt="" />
    </button>

    <div
      class="viewer-stage"
      on:wheel|preventDefault={handleWheel}
      role="presentation"
    >
      {#if src}
        <img
          src={src}
          {alt}
          class="viewer-image"
          class:dragging
          style="transform: translate({translateX}px, {translateY}px) scale({scale}) rotate({rotation}deg);"
          on:pointerdown|preventDefault={handlePointerDown}
          draggable="false"
        />
      {:else}
        <div class="viewer-empty">{$t('messaging.imageViewer.noImage')}</div>
      {/if}
    </div>

    <div class="viewer-bottom-bar">
      {#if authorName}
        <div class="viewer-sender">
          <div class="sender-avatar">
            {#if avatarSrc}
              <img src={avatarSrc} alt={authorName} />
            {:else}
              <div class="sender-avatar-placeholder">{authorName.charAt(0).toUpperCase()}</div>
            {/if}
          </div>
          <div class="sender-info">
            <span class="sender-name">{authorName}</span>
            {#if timestamp}
              <span class="sender-timestamp">{formatMessageTimestamp(timestamp)}</span>
            {/if}
          </div>
        </div>
      {/if}

      <div class="viewer-controls">
        <button
          type="button"
          class="viewer-btn"
          on:click|stopPropagation={zoomOut}
          aria-label="Zoom out"
        >
          −
        </button>
        <span class="zoom-level">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          class="viewer-btn"
          on:click|stopPropagation={zoomIn}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          class="viewer-btn viewer-icon-btn"
          on:click|stopPropagation={rotateImage}
          aria-label={$t('messaging.imageViewer.rotate')}
          title={$t('messaging.imageViewer.rotate')}
        >
          <img src={rotateIcon} alt="" />
        </button>
        <button
          type="button"
          class="viewer-btn viewer-icon-btn"
          on:click|stopPropagation={handleDownload}
          disabled={savingAs}
          aria-label={$t('messaging.imageViewer.download')}
          title={$t('messaging.imageViewer.download')}
        >
          <img src={downloadIcon} alt="" />
        </button>
        <div class="viewer-menu-wrapper" bind:this={menuWrapperEl}>
          <button
            type="button"
            class="viewer-btn viewer-icon-btn"
            on:click|stopPropagation={toggleMenu}
            aria-label={$t('messaging.imageViewer.moreOptions')}
            title={$t('messaging.imageViewer.moreOptions')}
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <span aria-hidden="true">⋯</span>
          </button>
          {#if menuOpen}
            <div class="viewer-menu" role="group" aria-label="Image actions">
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                aria-label={$t('messaging.imageViewer.showMessage')}
                title={$t('messaging.imageViewer.showMessage')}
                on:click|stopPropagation={handleShowMessage}
              >
                <span class="menu-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </span>
                <span class="menu-label">{$t('messaging.imageViewer.showMessage')}</span>
              </button>
              {#if canRevealInFolder() && localPath}
                <button
                  type="button"
                  class="menu-item"
                  role="menuitem"
                  aria-label={$t('messaging.imageViewer.showInFolder')}
                  title={$t('messaging.imageViewer.showInFolder')}
                  on:click|stopPropagation={handleRevealFromMenu}
                >
                  <span class="menu-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>
                    </svg>
                  </span>
                  <span class="menu-label">{$t('messaging.imageViewer.showInFolder')}</span>
                </button>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .image-viewer-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    background: rgba(0, 0, 0, 0.92);
    color: #ffffff;
  }

  .viewer-close {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 1;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.12);
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .viewer-close:hover {
    background: rgba(255, 255, 255, 0.22);
  }

  .viewer-close img {
    width: 18px;
    height: 18px;
  }

  .viewer-stage {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    touch-action: none;
  }

  .viewer-image {
    max-width: 90%;
    max-height: 90%;
    object-fit: contain;
    cursor: grab;
    user-select: none;
  }

  .viewer-image.dragging {
    cursor: grabbing;
  }

  .viewer-empty {
    opacity: 0.6;
    font-size: 0.9375rem;
  }

  .viewer-bottom-bar {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 16px;
    flex-shrink: 0;
  }

  .viewer-sender {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .sender-avatar {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
  }

  .sender-avatar img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .sender-avatar-placeholder {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    font-weight: 600;
    font-size: 0.9375rem;
  }

  .sender-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .sender-name {
    font-size: 0.875rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sender-timestamp {
    font-size: 0.75rem;
    opacity: 0.7;
  }

  .viewer-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .viewer-btn {
    background: rgba(255, 255, 255, 0.12);
    border: none;
    border-radius: 6px;
    color: #ffffff;
    padding: 6px 12px;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .viewer-btn:hover {
    background: rgba(255, 255, 255, 0.22);
  }

  .viewer-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .viewer-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
  }

  .viewer-icon-btn img {
    width: 18px;
    height: 18px;
  }

  .zoom-level {
    min-width: 48px;
    text-align: center;
    font-size: 0.875rem;
    opacity: 0.8;
  }

  .viewer-menu-wrapper {
    position: relative;
  }

  .viewer-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    min-width: 180px;
    padding: 6px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    color: initial;
  }

  .viewer-menu .menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    background: none;
    border: none;
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 0.875rem;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .viewer-menu .menu-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .viewer-menu .menu-item:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .viewer-menu .menu-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .viewer-menu .menu-item:hover .menu-icon {
    color: var(--text-primary);
  }

  .viewer-menu .menu-label {
    flex: 1;
  }
</style>
