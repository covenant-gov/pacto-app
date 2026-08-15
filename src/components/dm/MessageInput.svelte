<script lang="ts">
  import { tick, onDestroy, onMount } from 'svelte';
  import smileFaceIcon from '../../icons/smile-face.svg';
  import attachmentIcon from '../../icons/attachment.svg';
  import imageIcon from '../../icons/image.svg';
  import fileIcon from '../../icons/file.svg';
  import { getEmojiList, recentEmojisStore, addToRecentEmojis, searchEmojis } from '../../stores/emojis';
  import { showToast } from '../../stores/toast';
  import {
    pendingFilePreview,
    clearPendingAttachment,
    buildPendingFile,
    formatFileSize,
    isImageFile,
    shouldCompressImage,
    isAttachmentOversized,
    isDesktopFilePickerAvailable,
    getMimeTypeForExtension,
    generatePendingId,
    MAX_ATTACHMENT_BYTES,
    type PendingFileAttachment,
  } from '../../lib/messaging/attachment-composer';
  import { dropActive, registerAttachmentDrop } from '../../lib/messaging/attachment-drop';
  import { portal } from '../../lib/utils/portal';
  import {
    buildMentionCandidates,
    filterMentionCandidates,
    findActiveAtTrigger,
    replaceAtTrigger,
    type MentionCandidate,
  } from '../../lib/messaging/mention-autocomplete';
  import type { NostrProfile } from '../../lib/api/nostr';
  import type { Mention } from '../../lib/messaging/mentions';
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import { convertFileSrc, invoke } from '@tauri-apps/api/core';
  import { stickerPacks } from '../../stores/stickers';
  import { fetchStickerImage, type StickerPack, type StickerEntry } from '../../lib/api/stickers';
  import GifDisclosure from './GifDisclosure.svelte';
  import {
    searchGifs,
    trendingGifs,
    reportGifShare,
    klipyIsConfigured,
    isGifsDisclosureAccepted,
    acceptGifsDisclosure,
    createGifsSearchScheduler,
    type KlipyGif,
  } from '../../lib/api/klipy';

  export let channelName: string = "";
  /** When set, replaces the default `Message #{channelName}` placeholder (e.g. blocked peer). */
  export let placeholderOverride: string | undefined = undefined;
  export let onSend: (content: string, repliedTo?: string) => void = () => {};
  /** Optional: called for squad channels with a body + mention list so the caller can build the envelope. */
  export let onSendMentions: ((body: string, mentions: Mention[], repliedTo?: string) => void) | undefined = undefined;
  /** Optional: called with the bytes of a pending file attachment when the user sends it. */
  export let onSendFile:
    | ((bytes: ArrayBuffer, fileName: string, repliedTo: string, useCompression: boolean) => Promise<void>)
    | undefined = undefined;
  /** Optional: called with a picked GIF's URL + slug when the user sends it.
   * Never uploads bytes — Klipy's terms forbid re-hosting its media. */
  export let onSendGif:
    | ((url: string, slug: string, repliedTo: string) => Promise<void>)
    | undefined = undefined;
  /** Optional squad context; when provided, typing `@` opens the member mention picker. */
  export let squadMlsGroupId: string | undefined = undefined;
  export let squadRosterNpubs: string[] | undefined = undefined;
  export let squadProfiles: Record<string, NostrProfile | undefined> | undefined = undefined;
  /** Optional: current user's npub; excluded from mention candidates so you cannot @ yourself. */
  export let currentUserNpub: string | undefined = undefined;
  /** Optional: called when user types (e.g. to send typing indicator). */
  export let onTyping: (() => void) | undefined = undefined;
  /** When true, input and send are disabled (e.g. channel still being created). */
  export let disabled: boolean = false;
  /** Optional id of the message this reply is attached to. */
  export let repliedTo: string | undefined = undefined;
  /** Optional preview text of the replied-to message (shown instead of the generic label). */
  export let repliedToPreview: string | undefined = undefined;
  /** Optional: called when the user cancels the reply state. */
  export let onCancelReply: (() => void) | undefined = undefined;

  $: inputPlaceholder = placeholderOverride ?? $t('messaging.messageInput.placeholder', { values: { channelName } });
  const fullEmojiList = getEmojiList();

  let messageText = "";
  let textareaEl: HTMLTextAreaElement | undefined;
  let inputWrapperEl: HTMLDivElement | undefined;

  // Media panel (emoji + GIFs)
  let emojiPanelOpen = false;
  let emojiPanelTab: 'emoji' | 'gifs' | 'stickers' = 'emoji';
  let emojiSearchQuery = "";

  // Attachment type menu
  let attachmentMenuOpen = false;

  // Mention picker state
  let mentionPickerOpen = false;
  let mentionQuery = "";
  let mentionSelectedIndex = 0;
  let mentionStartIndex = 0;
  let mentionEndIndex = 0;
  let mentions: Mention[] = [];
  let mentionPickerEl: HTMLDivElement | undefined;
  let mentionSnappedHeight: number | null = null;

  // Attachment + reply state
  let fileInput: HTMLInputElement | undefined;
  let pendingInputAccept = '';
  let pendingInputCapture: 'environment' | undefined = undefined;
  let isSendingAttachment = false;
  let dropUnregister: (() => void) | undefined;
  let composerDestroyed = false;
  const desktopPickerAvailable = isDesktopFilePickerAvailable();

  const COMPOSER_MAX_HEIGHT_PX = 240;

  function resizeTextarea() {
    const ta = textareaEl;
    if (!ta) return;
    // Empty drafts use CSS min-height so the composer stays single-line inline.
    if (!ta.value) {
      ta.style.height = '';
      return;
    }
    // Collapse first so scrollHeight reflects content, not a previous inline height.
    ta.style.height = '0px';
    ta.style.height = `${Math.min(ta.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }

  onMount(() => {
    resizeTextarea();
    void (async () => {
      const unregister = await registerAttachmentDrop((paths) => {
        const first = paths[0];
        if (first) void setPendingFromPath(first);
      });
      if (composerDestroyed) {
        unregister();
      } else {
        dropUnregister = unregister;
      }
    })();
  });

  onDestroy(() => {
    clearPendingAttachment();
    composerDestroyed = true;
    dropUnregister?.();
    gifsSearchScheduler.cancel();
    gifsRequestToken++;
  });

  $: excludedNpubs = (() => {
    const set = new Set<string>();
    if (currentUserNpub) set.add(currentUserNpub);
    for (const m of mentions) set.add(m.npub);
    return set;
  })();
  $: mentionCandidates = squadMlsGroupId
    ? buildMentionCandidates(squadRosterNpubs ?? [], squadProfiles ?? {}, excludedNpubs)
    : [];
  $: filteredMentions = filterMentionCandidates(mentionCandidates, mentionQuery);

  $: if (disabled) {
    emojiPanelOpen = false;
    emojiSearchQuery = '';
    attachmentMenuOpen = false;
    closeMentionPicker();
  }

  function closeMentionPicker() {
    mentionPickerOpen = false;
    mentionQuery = '';
    mentionSelectedIndex = 0;
    mentionStartIndex = 0;
    mentionEndIndex = 0;
  }

  function openMentionPickerAtCursor() {
    if (!textareaEl || !squadMlsGroupId) return;
    const trigger = findActiveAtTrigger(messageText, textareaEl.selectionStart ?? messageText.length);
    if (!trigger) {
      closeMentionPicker();
      return;
    }
    mentionPickerOpen = true;
    mentionQuery = trigger.query;
    mentionStartIndex = trigger.start;
    mentionEndIndex = trigger.end;
    mentionSelectedIndex = 0;
  }

  async function selectMention(candidate: MentionCandidate) {
    const trigger = { start: mentionStartIndex, end: mentionEndIndex };
    const result = replaceAtTrigger(messageText, trigger, candidate.alias);
    messageText = result.value;
    mentions = [...mentions, { npub: candidate.npub, alias: candidate.alias }];
    closeMentionPicker();
    await tick();
    resizeTextarea();
    if (textareaEl) {
      textareaEl.setSelectionRange(result.cursor, result.cursor);
      textareaEl.focus();
    }
    onTyping?.();
  }

  function removeStaleMentions(text: string): Mention[] {
    if (mentions.length === 0) return [];
    return mentions.filter((m) => text.includes(`@${m.alias}`));
  }

  function handleMentionKeydown(event: KeyboardEvent) {
    if (!mentionPickerOpen) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      mentionSelectedIndex = Math.min(mentionSelectedIndex + 1, filteredMentions.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      mentionSelectedIndex = Math.max(mentionSelectedIndex - 1, 0);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      const candidate = filteredMentions[mentionSelectedIndex];
      if (candidate) void selectMention(candidate);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMentionPicker();
    }
  }

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (disabled || isSendingAttachment) return;
    if (mentionPickerOpen && filteredMentions[mentionSelectedIndex]) {
      void selectMention(filteredMentions[mentionSelectedIndex]);
      return;
    }
    const pending = $pendingFilePreview;
    if (pending && onSendFile) {
      await sendPendingAttachment(pending);
      return;
    }
    const body = messageText.trim();
    if (!body) return;
    const pruned = removeStaleMentions(body);
    if (onSendMentions && squadMlsGroupId) {
      onSendMentions(body, pruned, repliedTo);
    } else {
      onSend(body, repliedTo);
    }
    messageText = "";
    mentions = [];
    closeMentionPicker();
    await tick();
    resizeTextarea();
  }

  async function sendPendingAttachment(pending: PendingFileAttachment) {
    if (!onSendFile) return;
    isSendingAttachment = true;
    try {
      let bytes: ArrayBuffer;
      if (pending.filePath) {
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const data = await readFile(pending.filePath);
        bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      } else if (pending.file) {
        bytes = await pending.file.arrayBuffer();
      } else {
        throw new Error('No file data available for attachment');
      }
      const repliedToId = repliedTo ?? '';
      await onSendFile!(bytes, pending.fileName, repliedToId, shouldCompressImage(pending.fileName));
      clearPendingAttachment();
      messageText = "";
      mentions = [];
      closeMentionPicker();
      await tick();
      resizeTextarea();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to send attachment', undefined, undefined, {
        error: true,
      });
    } finally {
      isSendingAttachment = false;
    }
  }

  const IMAGE_VIDEO_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp4', 'mov', 'webm', 'mkv', 'avi'];
  const IMAGE_VIDEO_FILTER = {
    name: 'Photos & Videos',
    extensions: IMAGE_VIDEO_EXTENSIONS,
  };

  async function setPendingFromPath(path: string) {
    try {
      const info = await invoke<{ size: number; name: string; extension: string }>('get_file_info', {
        filePath: path,
      });
      if (isAttachmentOversized(info.size)) {
        showToast(
          get(t)('messaging.messageInput.tooLarge', {
            values: { size: formatFileSize(info.size), max: formatFileSize(MAX_ATTACHMENT_BYTES) },
          }),
          undefined,
          undefined,
          { error: true },
        );
        return;
      }
      const previewUrl = isImageFile(info.name)
        ? await invoke<string>('get_image_preview_base64', { filePath: path, quality: 25 }).catch(() => undefined)
        : undefined;
      const extension = info.extension.toLowerCase();
      pendingFilePreview.set({
        id: generatePendingId(),
        key: '',
        nonce: '',
        extension,
        url: previewUrl ?? '',
        path,
        size: info.size,
        fileName: info.name,
        filePath: path,
        previewUrl,
        mimeType: getMimeTypeForExtension(extension),
      });
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : get(t)('messaging.messageInput.readFailed'),
        undefined,
        undefined,
        { error: true },
      );
    }
  }

  async function chooseDesktopAttachment(kind: 'media' | 'file') {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: kind === 'media' ? [IMAGE_VIDEO_FILTER] : undefined,
      });
      if (selected === null) return;
      const path = Array.isArray(selected) ? selected[0] : selected;
      await setPendingFromPath(path);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : get(t)('messaging.messageInput.readFailed'),
        undefined,
        undefined,
        { error: true },
      );
    }
  }

  function handleFileInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (isAttachmentOversized(file.size)) {
      showToast(
        get(t)('messaging.messageInput.tooLarge', {
          values: { size: formatFileSize(file.size), max: formatFileSize(MAX_ATTACHMENT_BYTES) },
        }),
        undefined,
        undefined,
        { error: true },
      );
      input.value = '';
      return;
    }
    pendingFilePreview.set(buildPendingFile(file));
    input.value = '';
  }

  function handlePaste(event: ClipboardEvent) {
    const file = event.clipboardData?.files?.[0];
    if (!file) return;
    event.preventDefault();
    if (isAttachmentOversized(file.size)) {
      showToast(
        get(t)('messaging.messageInput.tooLarge', {
          values: { size: formatFileSize(file.size), max: formatFileSize(MAX_ATTACHMENT_BYTES) },
        }),
        undefined,
        undefined,
        { error: true },
      );
      return;
    }
    try {
      pendingFilePreview.set(buildPendingFile(file));
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : get(t)('messaging.messageInput.pasteFailed'),
        undefined,
        undefined,
        { error: true },
      );
    }
  }

  function closeAttachmentMenu() {
    attachmentMenuOpen = false;
  }

  function toggleAttachmentMenu(event: MouseEvent) {
    event.stopPropagation();
    if (disabled || isSendingAttachment) return;
    attachmentMenuOpen = !attachmentMenuOpen;
    if (attachmentMenuOpen) {
      emojiPanelOpen = false;
      emojiSearchQuery = '';
    }
  }

  async function pickAttachmentType(kind: 'media' | 'file' | 'camera', event: MouseEvent) {
    event.stopPropagation();
    closeAttachmentMenu();
    if (disabled || isSendingAttachment) return;
    if (kind === 'camera') {
      pendingInputAccept = 'image/*';
      pendingInputCapture = 'environment';
      await tick();
      fileInput?.click();
      return;
    }
    pendingInputCapture = undefined;
    if (isDesktopFilePickerAvailable()) {
      await chooseDesktopAttachment(kind);
    } else {
      pendingInputAccept = kind === 'media'
        ? 'image/*,video/*'
        : '';
      await tick();
      fileInput?.click();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (disabled) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      handleSubmit(event);
    } else if (event.key === 'Enter' && event.shiftKey) {
      // Allow default: insert newline in textarea (do not send)
    } else {
      handleMentionKeydown(event);
      onTyping?.();
    }
  }

  function handleInput() {
    resizeTextarea();
    openMentionPickerAtCursor();
    onTyping?.();
  }

  const MENTION_PICKER_GAP = 8;
  const MENTION_PICKER_MAX_HEIGHT = 240;
  const MENTION_PICKER_MAX_WIDTH = 320;
  const MENTION_PICKER_MIN_HEIGHT = 96;

  type MentionPickerPlacement = {
    left: number;
    edge: 'top' | 'bottom';
    offset: number;
    maxHeight: number;
  };

  /** Anchors the picker to the input box, aligned to the x-position of the active `@`. */
  function computeMentionPickerPlacement(
    text: string,
    startIndex: number,
    ta: HTMLTextAreaElement | undefined,
    wrapper: HTMLDivElement | undefined,
  ): MentionPickerPlacement | null {
    if (!ta || !wrapper) return null;
    const computed = window.getComputedStyle(ta);
    const clone = document.createElement('div');
    clone.style.cssText = `
      position: absolute;
      top: 0;
      left: -9999px;
      visibility: hidden;
      white-space: pre-wrap;
      word-wrap: break-word;
      width: ${ta.clientWidth}px;
      font: ${computed.font};
      line-height: ${computed.lineHeight};
      padding: ${computed.paddingTop} ${computed.paddingRight} ${computed.paddingBottom} ${computed.paddingLeft};
      border: ${computed.borderWidth} solid transparent;
    `;
    clone.textContent = text.slice(0, startIndex);
    const marker = document.createElement('span');
    marker.textContent = '@';
    clone.appendChild(marker);
    document.body.appendChild(clone);
    const caretOffsetLeft = marker.getBoundingClientRect().left - clone.getBoundingClientRect().left;
    document.body.removeChild(clone);

    const taRect = ta.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const left = Math.max(
      MENTION_PICKER_GAP,
      Math.min(
        taRect.left + caretOffsetLeft,
        window.innerWidth - MENTION_PICKER_MAX_WIDTH - MENTION_PICKER_GAP,
      ),
    );

    // Grow upward from the top edge of the input box so the panel stays flush with it.
    const spaceAbove = wrapperRect.top - MENTION_PICKER_GAP * 2;
    if (spaceAbove >= MENTION_PICKER_MIN_HEIGHT) {
      return {
        left,
        edge: 'bottom',
        offset: window.innerHeight - wrapperRect.top + MENTION_PICKER_GAP,
        maxHeight: Math.min(MENTION_PICKER_MAX_HEIGHT, spaceAbove),
      };
    }
    const top = wrapperRect.bottom + MENTION_PICKER_GAP;
    return {
      left,
      edge: 'top',
      offset: top,
      maxHeight: Math.min(MENTION_PICKER_MAX_HEIGHT, window.innerHeight - top - MENTION_PICKER_GAP),
    };
  }

  /** Trims the panel to the last fully visible row so an overflowing list never slices a member. */
  async function snapMentionPickerToWholeRows(
    _candidates: MentionCandidate[],
    placement: MentionPickerPlacement | null,
  ) {
    mentionSnappedHeight = null;
    if (!placement) return;
    await tick();
    const el = mentionPickerEl;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>('.mention-item');
    if (items.length === 0) return;
    const styles = window.getComputedStyle(el);
    const chromeBottom =
      parseFloat(styles.paddingBottom) + parseFloat(styles.borderBottomWidth);
    const elTop = el.getBoundingClientRect().top;
    const scrollTop = el.querySelector<HTMLElement>('.mention-list')?.scrollTop ?? 0;
    const heightThrough = (item: HTMLElement) =>
      item.getBoundingClientRect().bottom - elTop + scrollTop + chromeBottom;

    if (heightThrough(items[items.length - 1]) <= placement.maxHeight) return;
    let snapped: number | null = null;
    for (const item of items) {
      const height = heightThrough(item);
      if (height > placement.maxHeight) break;
      snapped = height;
    }
    mentionSnappedHeight = snapped;
  }

  /** Keeps the keyboard-selected row inside the scrollable panel. */
  async function scrollMentionSelectionIntoView(index: number) {
    await tick();
    mentionPickerEl?.querySelectorAll<HTMLElement>('.mention-item')[index]?.scrollIntoView({
      block: 'nearest',
    });
  }

  $: mentionPickerPlacement = mentionPickerOpen
    ? computeMentionPickerPlacement(messageText, mentionStartIndex, textareaEl, inputWrapperEl)
    : null;

  $: void snapMentionPickerToWholeRows(filteredMentions, mentionPickerPlacement);

  $: mentionPickerStyle = mentionPickerPlacement
    ? `left: ${mentionPickerPlacement.left}px; ${mentionPickerPlacement.edge}: ${mentionPickerPlacement.offset}px; max-height: ${Math.min(mentionPickerPlacement.maxHeight, mentionSnappedHeight ?? mentionPickerPlacement.maxHeight)}px;`
    : '';

  $: if (mentionPickerOpen) void scrollMentionSelectionIntoView(mentionSelectedIndex);

  /** Cap browse/search so opening the panel does not mount ~1k+ buttons and freeze the UI. */
  const EMOJI_BROWSE_LIMIT = 100;
  const EMOJI_SEARCH_LIMIT = 80;
  const EMOJI_GRID_BROWSE = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of fullEmojiList) {
      if (seen.has(entry.emoji)) continue;
      seen.add(entry.emoji);
      out.push(entry.emoji);
      if (out.length >= EMOJI_BROWSE_LIMIT) break;
    }
    return out;
  })();
  $: recentEmojis = $recentEmojisStore;
  $: searchResults = (() => {
    const q = emojiSearchQuery.trim();
    if (!q) return [];
    const seen = new Set<string>();
    const out: typeof fullEmojiList = [];
    for (const entry of searchEmojis(q)) {
      if (seen.has(entry.emoji)) continue;
      seen.add(entry.emoji);
      out.push(entry);
      if (out.length >= EMOJI_SEARCH_LIMIT) break;
    }
    return out;
  })();

  async function insertEmoji(emoji: string) {
    if (disabled) return;
    const ta = textareaEl;
    const start = ta ? (ta.selectionStart ?? messageText.length) : messageText.length;
    const end = ta ? (ta.selectionEnd ?? messageText.length) : messageText.length;
    messageText = messageText.slice(0, start) + emoji + messageText.slice(end);
    const entry = fullEmojiList.find((e) => e.emoji === emoji);
    if (entry) addToRecentEmojis(entry);
    await closeEmojiPanel({ refocusComposer: true });
    onTyping?.();
    await tick();
    resizeTextarea();
    if (textareaEl) {
      const pos = start + emoji.length;
      textareaEl.setSelectionRange(pos, pos);
    }
  }

  async function closeEmojiPanel(opts?: { refocusComposer?: boolean }) {
    emojiPanelOpen = false;
    emojiSearchQuery = '';
    emojiPanelTab = 'emoji';
    gifsSearchScheduler.cancel();
    gifsRequestToken++;
    if (opts?.refocusComposer) {
      await tick();
      textareaEl?.focus();
    }
  }

  function openEmojiPanel(event: MouseEvent) {
    event.stopPropagation();
    if (disabled) return;
    emojiPanelOpen = true;
    emojiPanelTab = 'emoji';
    emojiSearchQuery = '';
    attachmentMenuOpen = false;
  }

  function switchEmojiPanelTab(tab: 'emoji' | 'gifs' | 'stickers') {
    if (emojiPanelTab === 'gifs' && tab !== 'gifs') {
      gifsSearchScheduler.cancel();
      gifsRequestToken++;
    }
    emojiPanelTab = tab;
    if (tab === 'gifs') {
      gifsDisclosureAccepted = isGifsDisclosureAccepted();
    }
  }

  type StickerGroup = { pack: StickerPack; entries: StickerEntry[] };

  $: stickerGroups = ((): StickerGroup[] => {
    const q = emojiSearchQuery.trim().toLowerCase();
    const groups: StickerGroup[] = [];
    for (const pack of $stickerPacks) {
      const packNameMatches = q ? pack.name.toLowerCase().includes(q) : true;
      const entries = q && !packNameMatches
        ? pack.entries.filter((entry) => entry.shortcode.toLowerCase().includes(q))
        : pack.entries;
      if (entries.length > 0) groups.push({ pack, entries });
    }
    return groups;
  })();

  const STICKER_MIME_EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };

  let stickerImageCache: Record<string, string> = {};

  async function ensureStickerImageCached(entry: StickerEntry) {
    if (stickerImageCache[entry.url]) return;
    try {
      const path = await fetchStickerImage(entry.url, entry.key, entry.nonce);
      stickerImageCache = { ...stickerImageCache, [entry.url]: convertFileSrc(path) };
    } catch {
      // leave uncached; the item stays blank until a future render retries it
    }
  }

  $: if (emojiPanelTab === 'stickers') {
    for (const group of stickerGroups) {
      for (const entry of group.entries) {
        void ensureStickerImageCached(entry);
      }
    }
  }

  async function insertSticker(entry: StickerEntry) {
    if (disabled || isSendingAttachment || !onSendFile) return;
    isSendingAttachment = true;
    try {
      const path = await fetchStickerImage(entry.url, entry.key, entry.nonce);
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const data = await readFile(path);
      const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const fileName = `${entry.shortcode}.${STICKER_MIME_EXTENSIONS[entry.mime] ?? 'bin'}`;
      await onSendFile!(bytes, fileName, repliedTo ?? '', false);
      await closeEmojiPanel({ refocusComposer: true });
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('messaging.messageInput.readFailed'), undefined, undefined, {
        error: true,
      });
    } finally {
      isSendingAttachment = false;
    }
  }

  // GIFs tab (Klipy). Debounced search/trending, gated on the opt-in disclosure.
  let gifsDisclosureAccepted = false;
  let gifsResults: KlipyGif[] = [];
  let gifsPage = 1;
  let gifsHasMore = false;
  let gifsLoading = false;
  let gifsFetchFailed = false;
  let gifsConfigured: boolean | null = null;
  let gifsRequestToken = 0;
  const gifsSearchScheduler = createGifsSearchScheduler((query, page) => {
    void runGifsQuery(query, page);
  });

  async function runGifsQuery(query: string, page: number) {
    const token = ++gifsRequestToken;
    gifsLoading = true;
    gifsFetchFailed = false;
    try {
      if (gifsConfigured === null) {
        gifsConfigured = await klipyIsConfigured().catch(() => false);
        if (token !== gifsRequestToken) return;
      }
      if (!gifsConfigured) {
        gifsResults = [];
        gifsHasMore = false;
        return;
      }
      const trimmed = query.trim();
      const result = trimmed ? await searchGifs(trimmed, page) : await trendingGifs(page);
      if (token !== gifsRequestToken) return;
      gifsResults = page === 1 ? result.items : [...gifsResults, ...result.items];
      gifsPage = result.page;
      gifsHasMore = result.hasMore;
    } catch (err) {
      if (token !== gifsRequestToken) return;
      console.error('Klipy gifs fetch failed:', err);
      if (page === 1) gifsResults = [];
      gifsHasMore = false;
      gifsFetchFailed = true;
    } finally {
      if (token === gifsRequestToken) gifsLoading = false;
    }
  }

  function loadMoreGifs() {
    if (gifsLoading || !gifsHasMore) return;
    void runGifsQuery(emojiSearchQuery, gifsPage + 1);
  }

  function handleEmojiPanelBodyScroll(event: Event) {
    if (emojiPanelTab !== 'gifs') return;
    const el = event.currentTarget as HTMLDivElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      loadMoreGifs();
    }
  }

  $: if (emojiPanelOpen && emojiPanelTab === 'gifs' && gifsDisclosureAccepted) {
    gifsSearchScheduler.scheduleSearch(emojiSearchQuery);
  }

  function handleGifsDisclosureAccept() {
    acceptGifsDisclosure();
    gifsDisclosureAccepted = true;
  }

  function handleGifsDisclosureDecline() {
    switchEmojiPanelTab('emoji');
  }

  /** Sends a picked GIF as a lightweight, unencrypted attachment carrying the
   * Klipy URL byte-identical (never uploads or re-hosts the media — KD8). */
  async function sendGifUrl(gif: KlipyGif) {
    if (disabled || isSendingAttachment || !onSendGif) return;
    isSendingAttachment = true;
    try {
      await onSendGif(gif.fullUrl, gif.slug, repliedTo ?? '');
      await closeEmojiPanel({ refocusComposer: true });
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('messaging.messageInput.gifsSendFailed'), undefined, undefined, {
        error: true,
      });
    } finally {
      isSendingAttachment = false;
    }
  }

  function selectGif(gif: KlipyGif) {
    if (disabled || isSendingAttachment) return;
    reportGifShare(gif.slug, emojiSearchQuery.trim() || undefined).catch((err) => {
      console.error('Klipy share report failed:', err);
    });
    void sendGifUrl(gif);
  }

  function handleEmojiSearchKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      void closeEmojiPanel({ refocusComposer: true });
    }
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (emojiPanelOpen) {
      event.preventDefault();
      void closeEmojiPanel({ refocusComposer: true });
    }
    if (attachmentMenuOpen) {
      event.preventDefault();
      closeAttachmentMenu();
    }
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const insideEmoji = target.closest?.('.emoji-panel') || target.closest?.('.emoji-trigger-btn');
    if (emojiPanelOpen && !insideEmoji) {
      void closeEmojiPanel();
    }
    const insideAttach = target.closest?.('.attachment-menu') || target.closest?.('.attachment-trigger-btn');
    if (attachmentMenuOpen && !insideAttach) {
      closeAttachmentMenu();
    }
  }
</script>

<svelte:window on:pointerdown={handleClickOutside} on:keydown={handleGlobalKeydown} />

<div class="message-input-container" class:disabled>
  {#if $dropActive}
    <div class="drop-target-overlay" aria-hidden="true">
      <span>{$t('messaging.messageInput.dropToAttach')}</span>
    </div>
  {/if}
  <form on:submit|preventDefault={handleSubmit}>
    {#if repliedTo}
      <div class="reply-preview" role="region" aria-label="{$t('messaging.messageInput.replyingTo')} {repliedToPreview ?? $t('messaging.message.replyToDefault')}">
        <span class="reply-preview-label">{$t('messaging.messageInput.replyingTo')} {repliedToPreview ?? $t('messaging.message.replyToDefault')}</span>
        {#if onCancelReply}
          <button
            type="button"
            class="reply-preview-cancel"
            aria-label={$t('messaging.messageInput.cancelReplyAria')}
            title={$t('messaging.messageInput.cancelReplyAria')}
            on:click={onCancelReply}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M3 3l8 8M11 3L3 11"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
              />
            </svg>
          </button>
        {/if}
      </div>
    {/if}
    {#if $pendingFilePreview}
      <div class="attachment-preview" role="region" aria-label={$t('messaging.messageInput.pendingAttachmentAria')}>
        {#if $pendingFilePreview.previewUrl && isImageFile($pendingFilePreview.fileName)}
          <img
            src={$pendingFilePreview.previewUrl}
            alt=""
            class="attachment-preview-thumb"
          />
        {:else}
          <div class="attachment-preview-icon" aria-hidden="true">
            <img src={fileIcon} alt="" width="16" height="16" />
          </div>
        {/if}
        <div class="attachment-preview-info">
          <span class="attachment-preview-name">{$pendingFilePreview.fileName}</span>
          <span class="attachment-preview-size">{formatFileSize($pendingFilePreview.size)}</span>
        </div>
        <button
          type="button"
          class="attachment-preview-remove"
          aria-label={$t('messaging.messageInput.removeAttachmentAria')}
          title={$t('messaging.messageInput.removeAttachmentAria')}
          disabled={isSendingAttachment}
          on:click={clearPendingAttachment}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M3 3l8 8M11 3L3 11"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    {/if}
    <div class="input-wrapper" bind:this={inputWrapperEl}>
      <button
        type="button"

        class="attachment-trigger-btn"
        disabled={disabled || isSendingAttachment}
        aria-label={$t('messaging.messageInput.attachFile')}
        aria-expanded={attachmentMenuOpen}
        aria-haspopup="menu"
        title={$t('messaging.messageInput.attachFile')}
        on:click={toggleAttachmentMenu}
      >
        <img src={attachmentIcon} alt="" width="20" height="20" />
      </button>
      {#if attachmentMenuOpen && !disabled}
        <div
          class="attachment-menu"
          role="menu"
          aria-label={$t('messaging.messageInput.attachmentOptions')}
          tabindex="-1"
          on:pointerdown|stopPropagation
        >
          <button
            type="button"
            class="attachment-menu-item"
            role="menuitem"
            on:click={(e) => pickAttachmentType('media', e)}
          >
            <img src={imageIcon} alt="" width="20" height="20" />
            <span>{$t('messaging.messageInput.photoOrVideo')}</span>
          </button>
          <button
            type="button"
            class="attachment-menu-item"
            role="menuitem"
            on:click={(e) => pickAttachmentType('file', e)}
          >
            <img src={fileIcon} alt="" width="20" height="20" />
            <span>{$t('messaging.messageInput.fileOption')}</span>
          </button>
          {#if !desktopPickerAvailable}
            <button
              type="button"
              class="attachment-menu-item"
              role="menuitem"
              on:click={(e) => pickAttachmentType('camera', e)}
            >
              <img src={imageIcon} alt="" width="20" height="20" />
              <span>{$t('messaging.messageInput.takePhoto')}</span>
            </button>
          {/if}
        </div>
      {/if}
      <button
        type="button"
        class="emoji-trigger-btn"
        disabled={disabled || isSendingAttachment}
        aria-label={$t('messaging.messageInput.insertEmojiAria')}
        aria-expanded={emojiPanelOpen}
        aria-haspopup="dialog"
        title={$t('messaging.messageInput.insertEmojiAria')}
        on:click={openEmojiPanel}
      >
        <img src={smileFaceIcon} alt="" width="20" height="20" />
      </button>
      {#if emojiPanelOpen && !disabled}
        <div
          class="emoji-panel"
          class:emoji-panel--gifs={emojiPanelTab === 'gifs'}
          role="dialog"
          aria-label={$t('messaging.messageInput.insertEmojiAria')}
          tabindex="-1"
          on:pointerdown|stopPropagation
        >
          <div class="emoji-panel-search">
            <input
              type="text"
              class="emoji-search-input"
              placeholder={emojiPanelTab === 'gifs' ? $t('messaging.messageInput.gifsSearchPlaceholder') : emojiPanelTab === 'stickers' ? $t('messaging.messageInput.searchStickersPlaceholder') : $t('messaging.messageInput.searchEmojiPlaceholder')}
              bind:value={emojiSearchQuery}
              on:click|stopPropagation
              on:keydown={handleEmojiSearchKeydown}
              aria-label={emojiPanelTab === 'gifs' ? $t('messaging.messageInput.gifsSearchAria') : emojiPanelTab === 'stickers' ? $t('messaging.messageInput.searchStickersAria') : $t('messaging.messageInput.searchEmojiAria')}
            />
            <button
              type="button"
              class="emoji-picker-close"
              aria-label={$t('messaging.messageInput.closePanelAria')}
              title={$t('messaging.messageInput.close')}
              on:click|stopPropagation={() => closeEmojiPanel({ refocusComposer: true })}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d="M3 3l8 8M11 3L3 11"
                  stroke="currentColor"
                  stroke-width="1.75"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </div>
          <div class="emoji-panel-body" on:scroll={handleEmojiPanelBodyScroll}>
            {#if emojiPanelTab === 'emoji'}
              {#if emojiSearchQuery.trim()}
                <div class="emoji-picker-section">
                  {#if searchResults.length > 0}
                    <div class="emoji-picker-grid">
                      {#each searchResults as entry (entry.emoji)}
                        <button
                          type="button"
                          class="emoji-picker-item"
                          role="gridcell"
                          aria-label={$t('messaging.messageInput.insertEmojiNamed', { values: { emoji: entry.emoji } })}
                          on:click={() => insertEmoji(entry.emoji)}
                        >
                          {entry.emoji}
                        </button>
                      {/each}
                    </div>
                    {#if searchResults.length >= EMOJI_SEARCH_LIMIT}
                    <p class="emoji-picker-hint">{$t('messaging.messageInput.emojiSearchHint', { values: { limit: EMOJI_SEARCH_LIMIT } })}</p>
                    {/if}
                  {:else}
                    <p class="emoji-picker-empty">{$t('messaging.messageInput.noEmojisFound', { values: { query: emojiSearchQuery.trim() } })}</p>
                  {/if}
                </div>
              {:else}
                {#if recentEmojis.length > 0}
                  <div class="emoji-picker-section">
                    <span class="emoji-picker-label">{$t('messaging.messageInput.recent')}</span>
                    <div class="emoji-picker-row">
                      {#each recentEmojis as entry (entry.emoji)}
                        <button
                          type="button"
                          class="emoji-picker-item"
                          role="gridcell"
                          aria-label={$t('messaging.messageInput.insertEmojiNamed', { values: { emoji: entry.emoji } })}
                          on:click={() => insertEmoji(entry.emoji)}
                        >
                          {entry.emoji}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
                <div class="emoji-picker-section">
                  <span class="emoji-picker-label">{$t('messaging.messageInput.smileysAndMore')}</span>
                  <div class="emoji-picker-grid">
                    {#each EMOJI_GRID_BROWSE as emoji (emoji)}
                      <button
                        type="button"
                        class="emoji-picker-item"
                        role="gridcell"
                        aria-label={$t('messaging.messageInput.insertEmojiNamed', { values: { emoji } })}
                        on:click={() => insertEmoji(emoji)}
                      >
                        {emoji}
                      </button>
                    {/each}
                  </div>
                  <p class="emoji-picker-hint">{$t('messaging.messageInput.searchForMore')}</p>
                </div>
              {/if}
            {:else if emojiPanelTab === 'stickers'}
              {#if $stickerPacks.length === 0}
                <div class="emoji-picker-section">
                  <p class="emoji-picker-empty">{$t('messaging.messageInput.noStickerPacks')}</p>
                  <p class="emoji-picker-hint">{$t('messaging.messageInput.noStickerPacksHint')}</p>
                </div>
              {:else if stickerGroups.length === 0}
                <div class="emoji-picker-section">
                  <p class="emoji-picker-empty">{$t('messaging.messageInput.noStickersFound', { values: { query: emojiSearchQuery.trim() } })}</p>
                </div>
              {:else}
                {#each stickerGroups as group (group.pack.packId)}
                  <div class="emoji-picker-section">
                    <span class="emoji-picker-label">{group.pack.name}</span>
                    <div class="emoji-picker-grid">
                      {#each group.entries as entry (entry.shortcode)}
                        <button
                          type="button"
                          class="emoji-picker-item"
                          role="gridcell"
                          disabled={disabled || isSendingAttachment}
                          aria-label={$t('messaging.messageInput.insertStickerNamed', { values: { shortcode: entry.shortcode } })}
                          on:click={() => insertSticker(entry)}
                        >
                          {#if stickerImageCache[entry.url]}
                            <img src={stickerImageCache[entry.url]} alt={entry.shortcode} width="28" height="28" />
                          {/if}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/each}
              {/if}
            {:else}
              {#if !gifsDisclosureAccepted}
                <GifDisclosure onAccept={handleGifsDisclosureAccept} onDecline={handleGifsDisclosureDecline} />
              {:else if gifsConfigured === false || gifsFetchFailed}
                <div class="emoji-panel-placeholder">
                  <p>{$t('messaging.messageInput.gifsUnavailable')}</p>
                </div>
              {:else if gifsLoading && gifsResults.length === 0}
                <div class="emoji-panel-placeholder">
                  <p>{$t('messaging.messageInput.gifsLoading')}</p>
                </div>
              {:else if gifsResults.length === 0}
                <div class="emoji-picker-section">
                  <p class="emoji-picker-empty">{$t('messaging.messageInput.noGifsFound')}</p>
                </div>
              {:else}
                <div class="emoji-picker-section">
                  <div class="emoji-picker-grid gif-picker-grid">
                    {#each gifsResults as gif (gif.id)}
                      <button
                        type="button"
                        class="emoji-picker-item gif-picker-item"
                        role="gridcell"
                        disabled={disabled || isSendingAttachment}
                        aria-label={gif.title || gif.slug}
                        title={gif.title}
                        on:click={() => selectGif(gif)}
                      >
                        <img src={gif.previewUrl} alt={gif.title} loading="lazy" />
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
            {/if}
          </div>
          <div class="emoji-panel-tabs" role="tablist" aria-label={$t('messaging.messageInput.mediaPanelTabsAria')}>
            <button
              type="button"
              class="emoji-panel-tab"
              class:active={emojiPanelTab === 'emoji'}
              role="tab"
              aria-selected={emojiPanelTab === 'emoji'}
              aria-controls="emoji-panel-body"
              on:click={() => switchEmojiPanelTab('emoji')}
            >
              {$t('messaging.messageInput.emojiTab')}
            </button>
            <button
              type="button"
              class="emoji-panel-tab"
              class:active={emojiPanelTab === 'gifs'}
              role="tab"
              aria-selected={emojiPanelTab === 'gifs'}
              aria-controls="emoji-panel-body"
              disabled={disabled || isSendingAttachment}
              on:click={() => switchEmojiPanelTab('gifs')}
            >
              {$t('messaging.messageInput.gifsTab')}
            </button>
            <button
              type="button"
              class="emoji-panel-tab"
              class:active={emojiPanelTab === 'stickers'}
              role="tab"
              aria-selected={emojiPanelTab === 'stickers'}
              aria-controls="emoji-panel-body"
              disabled={disabled || isSendingAttachment}
              on:click={() => switchEmojiPanelTab('stickers')}
            >
              {$t('messaging.messageInput.stickersTab')}
            </button>
          </div>
        </div>
      {/if}
      <textarea
        bind:this={textareaEl}
        bind:value={messageText}
        on:keydown={handleKeydown}
        on:input={handleInput}
        on:paste={handlePaste}
        placeholder={inputPlaceholder}
        class="message-input"
        rows="1"
        disabled={disabled || isSendingAttachment}
      ></textarea>
      {#if mentionPickerOpen && !disabled}
        <div
          class="mention-picker"
          bind:this={mentionPickerEl}
          role="dialog"
          aria-label={$t('messaging.messageInput.mentionMember')}
          tabindex="-1"
          style={mentionPickerStyle}
          use:portal
          on:pointerdown|stopPropagation
        >
          {#if filteredMentions.length > 0}
            <ul class="mention-list" role="listbox" aria-label={$t('messaging.messageInput.mentionCandidates')}>
              {#each filteredMentions as candidate, i (candidate.npub)}
                <li
                  role="option"
                  aria-selected={i === mentionSelectedIndex}
                  class="mention-item"
                  class:selected={i === mentionSelectedIndex}
                  title={candidate.npub}
                  on:click|stopPropagation={() => selectMention(candidate)}
                  on:keydown={(e) => e.key === 'Enter' && selectMention(candidate)}
                  on:mouseenter={() => (mentionSelectedIndex = i)}
                >
                  {#if candidate.avatar}
                    <img src={candidate.avatar} alt="" class="mention-avatar" />
                  {:else}
                    <div class="mention-avatar mention-avatar-placeholder" aria-hidden="true">
                      <span>{candidate.displayName.charAt(0).toUpperCase()}</span>
                    </div>
                  {/if}
                  <div class="mention-info">
                    <span class="mention-name">{candidate.displayName}</span>
                    {#if candidate.trustSignal}
                      <span class="mention-trust">{candidate.trustSignal}</span>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="mention-empty">{$t('messaging.messageInput.noMembersFound', { values: { query: mentionQuery } })}</p>
          {/if}
        </div>
      {/if}
      <button
        type="button"
        class="send-button"
        disabled={disabled || isSendingAttachment || (!messageText.trim() && !$pendingFilePreview)}
        aria-label={$t('messaging.messageInput.sendMessage')}
        on:click={handleSubmit}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    </div>
    <input
      type="file"
      bind:this={fileInput}
      accept={pendingInputAccept}
      capture={pendingInputCapture}
      on:change={handleFileInputChange}
      style="display: none;"
      aria-hidden="true"
      tabindex="-1"
    />
  </form>
</div>

<style>
  .message-input-container {
    padding: 16px;
    background: var(--border-subtle);
    position: relative;
  }

  .message-input-container.disabled {
    opacity: 0.7;
    pointer-events: none;
  }

  .drop-target-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    border: 2px dashed var(--text-primary);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 600;
    z-index: 50;
    pointer-events: none;
  }

  form {
    width: 100%;
  }

  .input-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg-hover);
    border-radius: 8px;
    padding: 0 16px;
    transition: background 0.15s;
    position: relative;
  }

  .input-wrapper:focus-within {
    background: var(--border);
  }

  .emoji-trigger-btn,
  .attachment-trigger-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }

  .emoji-trigger-btn:hover:not(:disabled),
  .attachment-trigger-btn:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--code-border);
  }

  .emoji-trigger-btn:disabled,
  .attachment-trigger-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .emoji-trigger-btn img,
  .attachment-trigger-btn img {
    display: block;
  }

  .attachment-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    display: flex;
    flex-direction: column;
    min-width: 180px;
    padding: 6px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    z-index: 100;
  }

  .attachment-menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    background: none;
    border: none;
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 0.9375rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .attachment-menu-item:hover {
    background: var(--bg-hover);
  }

  .attachment-menu-item img {
    display: block;
    flex-shrink: 0;
  }

  .emoji-panel {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    display: flex;
    flex-direction: column;
    width: 320px;
    max-height: 360px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    z-index: 100;
    overflow: hidden;
  }

  .emoji-panel-search {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding: 10px 10px 6px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border-subtle);
  }

  .emoji-search-input {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    padding: 6px 10px;
    font-size: 0.8125rem;
    color: var(--text-primary);
    background: var(--bg-hover);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    outline: none;
  }

  .emoji-search-input::placeholder {
    color: var(--text-muted);
  }

  .emoji-search-input:focus {
    border-color: var(--brand);
  }

  .emoji-picker-close {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .emoji-picker-close:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .emoji-panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .emoji-panel-placeholder {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 0.9375rem;
    min-height: 160px;
  }

  .emoji-panel-tabs {
    display: flex;
    flex-shrink: 0;
    border-top: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
  }

  .emoji-panel-tab {
    flex: 1;
    padding: 10px 8px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.1s, border-color 0.1s;
  }

  .emoji-panel-tab:hover {
    color: var(--text-primary);
  }

  .emoji-panel-tab.active {
    color: var(--brand);
    border-bottom-color: var(--brand);
  }

  .emoji-picker-empty {
    margin: 0;
    padding: 12px 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .emoji-picker-hint {
    margin: 4px 0 0;
    font-size: 0.6875rem;
    color: var(--text-muted);
  }

  .emoji-picker-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .emoji-picker-label {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .emoji-picker-row {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }

  .emoji-picker-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 2px;
  }

  .emoji-picker-item {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    border-radius: 6px;
    font-size: 1.5rem;
    cursor: pointer;
    transition: background 0.1s;
  }

  .emoji-picker-item:hover {
    background: var(--bg-hover);
  }

  .emoji-panel--gifs {
    width: 384px;
    max-height: 420px;
  }

  .gif-picker-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .gif-picker-item {
    width: auto;
    height: auto;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    border-radius: 8px;
  }

  .gif-picker-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 8px;
  }

  .message-input {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    min-height: 1.4em;
    max-height: 240px;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    padding: 12px 0;
    font-family: inherit;
    resize: none;
    line-height: 1.4;
    overflow-y: auto;
  }

  .message-input::placeholder {
    color: var(--text-muted);
  }

  .send-button {
    background: transparent;
    border: none;
    outline: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    transition: color 0.15s;
  }

  .send-button:hover:not(:disabled) {
    color: var(--text-primary);
  }

  .send-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .send-button svg {
    width: 20px;
    height: 20px;
  }

  .mention-picker {
    position: fixed;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    min-width: 220px;
    max-width: 320px;
    max-height: 240px;
    overflow: hidden;
    padding: 6px 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    z-index: 1000;
  }

  .mention-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    min-height: 0;
  }

  .mention-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .mention-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--bg-hover);
  }

  .mention-avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-elevated);
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    border: 1px solid var(--border-subtle);
  }

  .mention-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .mention-item:hover,
  .mention-item.selected {
    background: var(--bg-hover);
  }

  .mention-name {
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 500;
  }

  .mention-trust {
    color: var(--text-muted);
    font-size: 0.75rem;
    font-family: ui-monospace, monospace;
  }

  .mention-empty {
    margin: 0;
    padding: 12px;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .reply-preview {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    margin-bottom: 8px;
    background: var(--bg-hover);
    border-radius: 8px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .reply-preview-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .reply-preview-cancel {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .reply-preview-cancel:hover {
    color: var(--text-primary);
    background: var(--code-border);
  }

  .attachment-preview {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    margin-bottom: 8px;
    background: var(--bg-hover);
    border-radius: 8px;
    min-width: 0;
  }

  .attachment-preview-thumb {
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
    background: var(--bg-elevated);
  }

  .attachment-preview-icon {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--text-muted);
    background: var(--bg-elevated);
    border-radius: 4px;
  }

  .attachment-preview-icon img {
    display: block;
  }

  .attachment-preview-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .attachment-preview-name {
    font-size: 0.875rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .attachment-preview-size {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .attachment-preview-remove {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
  }

  .attachment-preview-remove:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--code-border);
  }

  .attachment-preview-remove:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
