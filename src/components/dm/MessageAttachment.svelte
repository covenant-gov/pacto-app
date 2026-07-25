<script lang="ts">
  import { convertFileSrc } from '@tauri-apps/api/core';
  import { downloadAttachment, decodeBlurhash, saveAttachmentAs } from '../../lib/api/nostr';
  import { showToast } from '../../stores/toast';
  import { t } from 'svelte-i18n';
  import { createEventDispatcher } from 'svelte';
  import type { Attachment } from '../../stores/dm';
  import { attachmentKind, attachmentDisplayName, type AttachmentKind } from '../../lib/messaging/attachment-display';
  import ImageViewer from './ImageViewer.svelte';
  import fileIcon from '../../icons/file.svg';
  import playIcon from '../../icons/play.svg';
  import cloudDownloadIcon from '../../icons/cloud-download.svg';
  import saveIcon from '../../icons/download.svg';

  export let attachment: Attachment;
  export let chatId: string = '';
  export let messageId: string = '';
  /** Sender identity, threaded straight into the image viewer's bottom-left bar. */
  export let authorName: string = '';
  export let avatarSrc: string = '';
  export let timestamp: string = '';

  const dispatch = createEventDispatcher<{ showMessage: { messageId: string } }>();

  const KIND_LABEL_KEY: Record<AttachmentKind, string> = {
    image: 'messaging.attachment.image',
    video: 'messaging.attachment.video',
    audio: 'messaging.attachment.audio',
    document: 'messaging.attachment.document',
    spreadsheet: 'messaging.attachment.spreadsheet',
    archive: 'messaging.attachment.archive',
    file: 'messaging.attachment.file',
  };

  $: kind = attachmentKind(attachment.extension, attachment.img_meta != null);
  $: isImage = kind === 'image';
  $: isVideo = kind === 'video';
  $: isAudio = kind === 'audio';
  /** Image and video share the poster-tile surface; audio and documents are rows. */
  $: isTile = isImage || isVideo;
  $: displayName = attachmentDisplayName(attachment, (key) => $t(key));
  $: kindLabel = $t(KIND_LABEL_KEY[kind]);

  /** Decrypted local file, once `download_attachment` has written it. */
  $: localSrc =
    attachment.downloaded && attachment.path ? toDisplaySrc(attachment.path) : undefined;
  $: onDisk = localSrc != null;
  $: busy = downloading || attachment.downloading === true;

  /** Blurred stand-in shown until the real file is on disk. */
  let blurSrc: string | undefined;
  $: posterSrc = (isImage ? localSrc : undefined) ?? blurSrc;

  let viewerOpen = false;
  let downloading = false;
  let blurhashRequested = false;
  let savingAs = false;
  /** Set once the user asks to play; the element mounts as soon as the file is local. */
  let playRequested = false;

  // The blob on the media host is ciphertext, so there is nothing to show until
  // the backend has fetched and decrypted it. Until then, fall back to the
  // blurhash carried in the message itself. Video needs it even once the file
  // is local, because a video element is not a poster.
  $: if (isTile && posterSrc == null && !blurhashRequested && attachment.img_meta?.blurhash) {
    blurhashRequested = true;
    void loadBlurhash(attachment.img_meta.blurhash, attachment.img_meta.width, attachment.img_meta.height);
  }

  /** Real dimensions when the sender supplied them, so the tile reserves the right box. */
  $: tileAspect =
    attachment.img_meta && attachment.img_meta.width > 0 && attachment.img_meta.height > 0
      ? `${attachment.img_meta.width} / ${attachment.img_meta.height}`
      : '4 / 3';

  $: sizeLabel = formatBytes(attachment.size);

  /** Exactly one accessible name per tile state: fetch, play, or view. */
  $: tileActionLabel = !onDisk
    ? $t('messaging.attachment.download', { values: { name: displayName } })
    : isVideo
      ? $t('messaging.attachment.play', { values: { name: displayName } })
      : $t('messaging.attachment.open', { values: { name: displayName } });

  async function loadBlurhash(hash: string, width: number, height: number) {
    try {
      blurSrc = await decodeBlurhash(hash, width || 32, height || 32);
    } catch {
      // leave blank; the placeholder icon renders instead
    }
  }

  function toDisplaySrc(pathOrUrl: string): string {
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      return pathOrUrl;
    }
    if (
      typeof window !== 'undefined' &&
      (window as Window & { __TAURI__?: unknown }).__TAURI__ &&
      (pathOrUrl.startsWith('/') || /^[A-Za-z]:[\\/]/.test(pathOrUrl))
    ) {
      return convertFileSrc(pathOrUrl);
    }
    return pathOrUrl;
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  async function handleDownload(event?: MouseEvent) {
    event?.stopPropagation();
    if (busy || !chatId || !messageId || !attachment.id) return;
    downloading = true;
    try {
      // Success arrives as a `message_update` carrying the decrypted local path.
      await downloadAttachment(chatId, messageId, attachment.id);
    } finally {
      downloading = false;
    }
  }

  /** Plays now when the file is local, otherwise fetches first and plays on arrival. */
  async function handlePlay(event?: MouseEvent) {
    event?.stopPropagation();
    playRequested = true;
    if (!onDisk) await handleDownload(event);
  }

  /** Downloaded images open the viewer; anything else downloads first. */
  function handleImageClick(event?: MouseEvent) {
    if (localSrc) {
      event?.stopPropagation();
      viewerOpen = true;
      return;
    }
    void handleDownload(event);
  }

  /**
   * Single entry point for the tile button. Video always routes to playback
   * (fetching first when needed); an image opens the viewer once it is local.
   */
  function handleTileClick(event?: MouseEvent) {
    if (isVideo) {
      void handlePlay(event);
      return;
    }
    handleImageClick(event);
  }

  /** Prompts for a destination and copies the (downloaded + decrypted) attachment there. */
  async function handleSaveAs(event?: MouseEvent) {
    event?.stopPropagation();
    if (savingAs) return;
    // No Tauri dialog plugin outside the desktop shell (web preview, tests without a mock).
    if (typeof window === 'undefined' || !(window as Window & { __TAURI__?: unknown }).__TAURI__) return;
    savingAs = true;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const destPath = await save({
        title: $t('messaging.attachment.saveDialogTitle'),
        defaultPath: displayName,
      });
      if (!destPath) return;
      const savedPath = await saveAttachmentAs(chatId, messageId, attachment.id, destPath);
      showToast($t('messaging.attachment.saved', { values: { path: savedPath } }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : $t('messaging.attachment.saveFailed'), undefined, undefined, {
        error: true,
      });
    } finally {
      savingAs = false;
    }
  }

  function forwardShowMessage(event: CustomEvent<{ messageId: string }>) {
    dispatch('showMessage', event.detail);
  }
</script>

<div class="attachment" class:tile-layout={isTile}>
  {#if isTile}
    <div class="media-tile" style="--tile-aspect: {tileAspect}">
      {#if isVideo && playRequested && localSrc}
        <!-- svelte-ignore a11y-media-has-caption -->
        <video
          class="tile-media"
          src={localSrc}
          controls
          autoplay
          preload="metadata"
        ></video>
      {:else}
        <!--
          The tile itself is the primary action (fetch, then play/open). The
          corner action is a secondary, always-top-left affordance: purely
          decorative before download (the tile already fetches on click), a
          real Save as… button once the file is local — the primary action
          has moved on to play/open by then, so saving needs its own control.
        -->
        <button
          type="button"
          class="tile-surface"
          on:click={handleTileClick}
          aria-label={tileActionLabel}
          disabled={busy}
        >
          {#if posterSrc}
            <img class="tile-poster" src={posterSrc} alt={displayName} loading="lazy" />
          {:else}
            <span class="tile-placeholder" aria-hidden="true">
              <img src={fileIcon} alt="" />
            </span>
          {/if}

          {#if isVideo}
            <span class="play-badge" aria-hidden="true">
              <img src={playIcon} alt="" />
            </span>
          {/if}
        </button>

        {#if !onDisk}
          <span class="corner-action pending" aria-hidden="true">
            <img src={cloudDownloadIcon} alt="" />
          </span>
        {:else}
          <button
            type="button"
            class="corner-action"
            on:click={handleSaveAs}
            disabled={savingAs}
            title={$t('messaging.attachment.saveAs')}
            aria-label={$t('messaging.attachment.saveAs')}
          >
            <img src={saveIcon} alt="" />
          </button>
        {/if}
      {/if}
    </div>
  {:else if isAudio && onDisk}
    <div class="media-row">
      <div class="row-header">
        <span class="row-name" title={displayName}>{displayName}</span>
        <button
          type="button"
          class="corner-action inline"
          on:click={handleSaveAs}
          disabled={savingAs}
          title={$t('messaging.attachment.saveAs')}
          aria-label={$t('messaging.attachment.saveAs')}
        >
          <img src={saveIcon} alt="" />
        </button>
      </div>
      <audio
        controls
        preload="metadata"
        src={localSrc}
        autoplay={playRequested}
      ></audio>
    </div>
  {:else}
    <div class="file-card">
      <button
        type="button"
        class="file-card-surface"
        on:click={handleDownload}
        aria-label={$t('messaging.attachment.download', { values: { name: displayName } })}
        disabled={busy}
      >
        <span class="lead-badge" class:pending={!onDisk} aria-hidden="true">
          <img src={onDisk ? fileIcon : cloudDownloadIcon} alt="" />
        </span>
        <span class="file-meta">
          <span class="file-name" title={displayName}>{displayName}</span>
          <span class="file-size">
            {busy ? $t('messaging.attachment.downloading') : `${kindLabel} \u00b7 ${sizeLabel}`}
          </span>
        </span>
      </button>
      {#if onDisk}
        <button
          type="button"
          class="corner-action inline"
          on:click={handleSaveAs}
          disabled={savingAs}
          title={$t('messaging.attachment.saveAs')}
          aria-label={$t('messaging.attachment.saveAs')}
        >
          <img src={saveIcon} alt="" />
        </button>
      {/if}
    </div>
  {/if}
</div>

<ImageViewer
  bind:open={viewerOpen}
  src={posterSrc}
  localPath={attachment.path}
  alt={displayName}
  {authorName}
  {avatarSrc}
  {timestamp}
  {chatId}
  {messageId}
  attachmentId={attachment.id}
  on:showMessage={forwardShowMessage}
/>

<style>
  .attachment {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 6px;
    max-width: 100%;
    min-width: 0;
  }

  /*
   * Tiles own their row so the save control wraps beneath instead of squeezing
   * them. `flex` gives the tile a definite width to resolve `100%` against —
   * it grows with the message column and shrinks on narrow windows.
   */
  .attachment.tile-layout {
    flex-direction: column;
    flex: 1 1 280px;
    max-width: 420px;
  }

  .media-tile {
    position: relative;
    width: 100%;
    max-width: 100%;
    margin: 4px 0;
    border-radius: 12px;
    overflow: hidden;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  }

  .tile-surface {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: var(--tile-aspect, 4 / 3);
    max-height: 420px;
    padding: 0;
    border: none;
    background: var(--bg-hover);
    cursor: pointer;
  }

  .tile-surface:disabled {
    cursor: default;
  }

  .tile-poster,
  .tile-placeholder {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .tile-poster {
    object-fit: cover;
    display: block;
  }

  .tile-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tile-placeholder img {
    width: 32px;
    height: 32px;
    object-fit: contain;
    opacity: 0.5;
  }

  .tile-media {
    display: block;
    width: 100%;
    max-height: 420px;
    background: #000;
  }

  /*
   * Same fixed-size round affordance everywhere an attachment can be
   * fetched or saved: a decorative cloud icon before download (the
   * surface underneath handles the click), a real Save as… button once
   * the file is local. Tiles overlay it on the poster (`.corner-action`);
   * rows and cards lay it out inline (`.corner-action.inline`).
   */
  .corner-action {
    position: absolute;
    top: 8px;
    left: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(2px);
  }

  .corner-action.inline {
    position: static;
    flex-shrink: 0;
  }

  .corner-action.pending {
    pointer-events: none;
  }

  button.corner-action {
    cursor: pointer;
  }

  button.corner-action:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.78);
  }

  button.corner-action:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .corner-action img {
    width: 16px;
    height: 16px;
  }

  .play-badge {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
  }

  .tile-surface:hover:not(:disabled) .play-badge {
    background: rgba(0, 0, 0, 0.72);
  }

  .play-badge img {
    width: 26px;
    height: 26px;
    margin-left: 3px;
    filter: invert(1);
  }

  .media-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    margin: 4px 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    flex: 1 1 240px;
    max-width: 340px;
    min-width: 0;
  }

  .row-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .row-name {
    font-size: 0.8125rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .media-row audio {
    width: 100%;
  }

  .file-card {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    margin: 4px 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    flex: 1 1 240px;
    max-width: 340px;
    min-width: 0;
  }

  .file-card-surface {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: none;
    text-align: left;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .file-card-surface:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .file-card-surface:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .lead-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
  }

  .lead-badge img {
    width: 28px;
    height: 28px;
  }

  /* Undownloaded files get the same dark cloud chip as the media tiles. */
  .lead-badge.pending {
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.62);
  }

  .lead-badge.pending img {
    width: 20px;
    height: 20px;
  }

  .file-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .file-name {
    font-size: 0.875rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-size {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
