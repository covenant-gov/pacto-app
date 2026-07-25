<script lang="ts">
  import { tick } from 'svelte';
  import FormattedMessageBody from './FormattedMessageBody.svelte';
  import MessageAttachment from './MessageAttachment.svelte';
  import LinkPreview from './LinkPreview.svelte';
  import MessageActionsMenu from './MessageActionsMenu.svelte';
  import { formatMessageTimestamp } from '../../lib/utils/message-formatting';
  import { summarizeStructuredMessageContent } from '../../lib/messaging/structured-content-notice';
  import { aggregateReactions, isPendingReaction, pendingReactionSent } from '../../lib/messaging/reactions';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../lib/utils/profile';
  import { attachmentKind } from '../../lib/messaging/attachment-display';
  import { getEmojiList, recentEmojisStore, searchEmojis } from '../../stores/emojis';
  import type { Mention } from '../../lib/messaging/mentions';
  import type { NostrProfile } from '../../lib/api/nostr';
  import { t } from 'svelte-i18n';
  import type { Attachment, Reaction, PreviewMetadata, DmMessage } from '../../stores/dm';
  import { observeLinkPreview } from '../../lib/messaging/link-preview-observer';

  export let id: string = '';
  export let authorName: string = '';
  export let content: string = '';
  export let body: string = '';
  export let mentions: Mention[] | undefined = undefined;
  export let rosterNpubs: string[] | Set<string> | undefined = undefined;
  export let profiles: Record<string, NostrProfile | undefined> | undefined = undefined;
  export let currentUserNpub: string | undefined = undefined;
  export let isMentioned: boolean = false;
  export let timestamp: string = '';
  export let avatar: string = '';
  /** Hide avatar + name/timestamp; nest under the previous message from the same author. */
  export let compact: boolean = false;
  /** When set, show a reply bar above the body (author + truncated content or "Attachment"). */
  export let replyToId: string | undefined = undefined;
  export let replyAuthorName: string | undefined = undefined;
  export let replyPreview: string | undefined = undefined;
  export let reactions: Reaction[] | undefined = undefined;
  export let attachments: Attachment[] | undefined = undefined;
  export let previewMetadata: PreviewMetadata | null | undefined = undefined;
  export let chatId: string = '';
  export let pending: boolean = false;
  export let onReact: (messageId: string, emoji: string) => void = () => {};
  export let onCopy: (messageId: string, text: string) => void = () => {};
  export let onReply: (messageId: string) => void = () => {};

  $: displayContent = body || content;
  /** Only fields `requestLinkPreview` reads are populated; viewport-triggered via `observeLinkPreview`. */
  $: linkPreviewParams = chatId && id
    ? { chatId, message: { id, content, pending, preview_metadata: previewMetadata } as DmMessage }
    : undefined;
  $: structuredNotice = summarizeStructuredMessageContent(displayContent, $t);
  $: aggregated = aggregateReactions(reactions ?? [], currentUserNpub ?? '');
  /** Telegram-style reactions overlay onto the last attachment when it's an image/video tile; otherwise they sit in normal flow below the content. */
  $: lastAttachmentIsTile = (() => {
    if (!attachments || attachments.length === 0) return false;
    const last = attachments[attachments.length - 1];
    const kind = attachmentKind(last.extension, last.img_meta != null);
    return kind === 'image' || kind === 'video';
  })();
  $: reactionsOverlayMedia = lastAttachmentIsTile && aggregated.length > 0;

  function jumpToMessage(targetId: string) {
    const el = document.getElementById(`msg-${targetId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function jumpToReply() {
    if (!replyToId) return;
    jumpToMessage(replyToId);
  }

  function handleAttachmentShowMessage(event: CustomEvent<{ messageId: string }>) {
    jumpToMessage(event.detail.messageId);
  }

  let menuOpen = false;
  let menuX = 0;
  let menuY = 0;
  let menuAnchorEl: HTMLElement | undefined;
  let popoverEl: HTMLElement | undefined;
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;

  /** Combined menu has two panels: the quick-reaction bar + action list, or the expanded emoji picker. */
  let pickerExpanded = false;
  let emojiSearchQuery = '';

  const QUICK_REACTIONS = ['🥰', '❤️', '👍', '👎', '🔥', '👏', '😁'];
  const COMMON_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉', '👏'];
  const EMOJI_PICKER_LIMIT = 60;
  const fullEmojiList = getEmojiList();
  const EMOJI_GRID_ALL = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of fullEmojiList) {
      if (seen.has(entry.emoji)) continue;
      seen.add(entry.emoji);
      out.push(entry.emoji);
    }
    return out;
  })();

  $: recentEmojis = $recentEmojisStore.map((e) => e.emoji);
  $: emojiSearchResults = emojiSearchQuery.trim()
    ? searchEmojis(emojiSearchQuery.trim()).slice(0, EMOJI_PICKER_LIMIT)
    : [];
  $: quickReactedSet = new Set(aggregated.filter((r) => r.includesMe).map((r) => r.emoji));

  let longPressStartX = 0;
  let longPressStartY = 0;

  /** Reactor-list tooltip: at most one chip's tooltip is open at a time. */
  let reactionTooltipEmoji: string | null = null;
  const REACTOR_TOOLTIP_LIMIT = 8;
  let chipLongPressTimer: ReturnType<typeof setTimeout> | undefined;
  let chipLongPressTriggered = false;
  let chipLongPressStartX = 0;
  let chipLongPressStartY = 0;

  async function clampPopover() {
    await tick();
    if (!popoverEl) return;
    const rect = popoverEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = menuX;
    let top = menuY;
    if (left + rect.width > vw - 8) {
      left = Math.max(8, vw - rect.width - 8);
    }
    if (top + rect.height > vh - 8) {
      top = Math.max(8, vh - rect.height - 8);
    }
    if (left !== menuX) menuX = left;
    if (top !== menuY) menuY = top;
  }

  async function openMenu(x: number, y: number) {
    menuX = x;
    menuY = y;
    pickerExpanded = false;
    emojiSearchQuery = '';
    menuOpen = true;
    await clampPopover();
  }

  function closeMenu() {
    menuOpen = false;
    pickerExpanded = false;
  }

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    openMenu(event.clientX, event.clientY);
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.button !== 0 || longPressTimer) return;
    longPressStartX = event.clientX;
    longPressStartY = event.clientY;
    longPressTimer = setTimeout(() => {
      openMenu(longPressStartX, longPressStartY);
    }, 600);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!longPressTimer) return;
    const dx = event.clientX - longPressStartX;
    const dy = event.clientY - longPressStartY;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
  }

  function handlePointerUp() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
  }

  function handleWindowPointerDown(event: MouseEvent) {
    const target = event.target as Node | null;
    if (menuOpen && !(target && popoverEl?.contains(target))) {
      closeMenu();
    }
    if (reactionTooltipEmoji) {
      const chipEl = target instanceof Element ? target.closest('.reaction-chip') : null;
      const withinTooltip = target instanceof Element ? target.closest('.reactor-tooltip') : null;
      const isOpenChip = chipEl?.getAttribute('data-emoji') === reactionTooltipEmoji;
      if (!isOpenChip && !withinTooltip) {
        reactionTooltipEmoji = null;
      }
    }
  }

  function firstGraphemeCluster(text: string): string {
    if (!text) return '';
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
      const iter = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)[Symbol.iterator]();
      const first = iter.next().value;
      if (first) return first.segment;
    }
    return Array.from(text)[0] ?? '';
  }

  async function expandPicker() {
    pickerExpanded = true;
    emojiSearchQuery = '';
    await clampPopover();
  }

  async function collapsePicker() {
    pickerExpanded = false;
    await clampPopover();
  }

  function reactAndClose(rawEmoji: string) {
    const emoji = firstGraphemeCluster(rawEmoji);
    if (!emoji) {
      closeMenu();
      return;
    }
    const alreadyReacted = aggregated.some((r) => r.emoji === emoji && r.includesMe);
    if (alreadyReacted || isPendingReaction(id, emoji)) {
      closeMenu();
      return;
    }
    pendingReactionSent(id, emoji);
    onReact(id, emoji);
    closeMenu();
  }

  function handleQuickReact(emoji: string) {
    reactAndClose(emoji);
  }

  function handlePickerSelect(rawEmoji: string) {
    reactAndClose(rawEmoji);
  }

  function handleMenuCopy() {
    closeMenu();
    onCopy(id, displayContent);
  }

  function handleMenuReply() {
    closeMenu();
    onReply(id);
  }

  function handleChipClick(emoji: string, includesMe: boolean) {
    if (chipLongPressTriggered) {
      chipLongPressTriggered = false;
      return;
    }
    if (includesMe) return;
    if (isPendingReaction(id, emoji)) return;
    pendingReactionSent(id, emoji);
    onReact(id, emoji);
  }

  function openChipTooltip(emoji: string) {
    reactionTooltipEmoji = emoji;
  }

  function closeChipTooltip(emoji: string) {
    if (reactionTooltipEmoji === emoji) {
      reactionTooltipEmoji = null;
    }
  }

  function handleChipKeydown(event: KeyboardEvent, emoji: string) {
    if (event.key === 'Escape' && reactionTooltipEmoji === emoji) {
      event.stopPropagation();
      reactionTooltipEmoji = null;
    }
  }

  /** Touch/pen long-press reveals the reactor tooltip without also firing the chip's react-toggle click. */
  function handleChipPointerDown(event: PointerEvent, emoji: string) {
    if (event.pointerType === 'mouse' || chipLongPressTimer) return;
    chipLongPressTriggered = false;
    chipLongPressStartX = event.clientX;
    chipLongPressStartY = event.clientY;
    chipLongPressTimer = setTimeout(() => {
      chipLongPressTriggered = true;
      chipLongPressTimer = undefined;
      reactionTooltipEmoji = emoji;
    }, 600);
  }

  function handleChipPointerMove(event: PointerEvent) {
    if (!chipLongPressTimer) return;
    const dx = event.clientX - chipLongPressStartX;
    const dy = event.clientY - chipLongPressStartY;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      clearTimeout(chipLongPressTimer);
      chipLongPressTimer = undefined;
    }
  }

  function handleChipPointerUp() {
    if (chipLongPressTimer) {
      clearTimeout(chipLongPressTimer);
      chipLongPressTimer = undefined;
    }
  }
</script>

<svelte:window on:pointerdown={handleWindowPointerDown} />

<div
  class="message"
  class:compact
  class:mentioned={isMentioned}
  id={id ? `msg-${id}` : undefined}
  bind:this={menuAnchorEl}
  use:observeLinkPreview={linkPreviewParams}
  on:contextmenu={handleContextMenu}
  on:pointerdown={handlePointerDown}
  on:pointermove={handlePointerMove}
  on:pointerup={handlePointerUp}
  on:pointercancel={handlePointerUp}
  role="listitem"
  aria-label={$t('messaging.message.fromAuthorAria', { values: { authorName } })}
>
  <div class="avatar" aria-hidden={compact ? 'true' : undefined}>
    {#if !compact}
      {#if avatar}
        <img src={avatar} alt={authorName} />
      {:else}
        <div class="avatar-placeholder">{authorName.charAt(0).toUpperCase()}</div>
      {/if}
    {/if}
  </div>
  <div class="message-content">
    {#if !compact}
      <div class="message-header">
        <span class="author-name">{authorName}</span>
        <span class="timestamp"><time datetime={timestamp}>{formatMessageTimestamp(timestamp)}</time></span>
        <button
          type="button"
          class="message-options-btn"
          aria-label={$t('messaging.message.optionsAria')}
          title={$t('messaging.message.optionsAria')}
          on:click|stopPropagation={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openMenu(rect.left, rect.bottom + 4);
          }}
        >
          <span aria-hidden="true">⋯</span>
        </button>
      </div>
    {/if}
    {#if replyToId && (replyAuthorName != null || replyPreview != null)}
      <div class="msg-reply" role="region" aria-label={$t('messaging.message.replyTo', { values: { name: replyAuthorName ?? $t('messaging.message.replyToDefault') } })}>
        <button
          type="button"
          class="msg-reply-inner"
          on:click={jumpToReply}
          aria-label={$t('messaging.message.jumpToReply')}
        >
          <span class="msg-reply-author">{replyAuthorName ?? $t('messaging.message.replyUnknown')}</span>
          <span class="msg-reply-preview">{#if replyPreview}{replyPreview}{/if}</span>
        </button>
      </div>
    {/if}
    <div class="message-body">
      <div class="message-text">
        {#if structuredNotice}
          <span class="structured-notice">{structuredNotice}</span>
        {:else}
          <FormattedMessageBody content={displayContent} {mentions} {profiles} {rosterNpubs} />
        {/if}
      </div>
      {#if previewMetadata}
        <LinkPreview metadata={previewMetadata} />
      {/if}
      {#if attachments && attachments.length > 0}
        <div class="message-attachments" aria-label={$t('messaging.message.attachmentsAria')}>
          {#each attachments as attachment (attachment.id)}
            <MessageAttachment
              {attachment}
              {chatId}
              messageId={id}
              {authorName}
              avatarSrc={avatar}
              {timestamp}
              on:showMessage={handleAttachmentShowMessage}
            />
          {/each}
        </div>
      {/if}
      {#if aggregated.length > 0}
        <div class="message-reactions" class:overlay-media={reactionsOverlayMedia} role="group" aria-label={$t('messaging.message.reactionsAria')}>
          {#each aggregated as chip (chip.emoji)}
            <div class="reaction-chip-wrap">
              <button
                type="button"
                class="reaction-chip"
                class:own={chip.includesMe}
                data-emoji={chip.emoji}
                aria-pressed={chip.includesMe}
                aria-label="{chip.emoji} {chip.count}"
                aria-haspopup="true"
                aria-expanded={reactionTooltipEmoji === chip.emoji}
                on:click={() => handleChipClick(chip.emoji, chip.includesMe)}
                on:mouseenter={() => openChipTooltip(chip.emoji)}
                on:mouseleave={() => closeChipTooltip(chip.emoji)}
                on:focus={() => openChipTooltip(chip.emoji)}
                on:blur={() => closeChipTooltip(chip.emoji)}
                on:keydown={(e) => handleChipKeydown(e, chip.emoji)}
                on:pointerdown|stopPropagation={(e) => handleChipPointerDown(e, chip.emoji)}
                on:pointermove|stopPropagation={handleChipPointerMove}
                on:pointerup|stopPropagation={handleChipPointerUp}
                on:pointercancel|stopPropagation={handleChipPointerUp}
              >
                <span class="reaction-emoji">{chip.emoji}</span>
                <span class="reaction-count">{chip.count}</span>
              </button>
              {#if reactionTooltipEmoji === chip.emoji}
                <div
                  class="reactor-tooltip"
                  role="tooltip"
                  aria-label={$t('messaging.message.reactedWith', { values: { emoji: chip.emoji } })}
                >
                  {#each chip.reactorIds.slice(0, REACTOR_TOOLTIP_LIMIT) as npub (npub)}
                    {@const reactorProfile = profiles?.[npub]}
                    {@const reactorAvatarSrc = getProfileAvatarSrc(reactorProfile)}
                    {@const reactorName = npub === currentUserNpub
                      ? $t('messaging.message.authorYou')
                      : reactorProfile
                        ? getProfileDisplayName(reactorProfile)
                        : npub.slice(0, 16) + '…'}
                    <div class="reactor-tooltip-entry">
                      {#if reactorAvatarSrc}
                        <img src={reactorAvatarSrc} alt="" class="reactor-tooltip-avatar" />
                      {:else}
                        <div class="reactor-tooltip-avatar reactor-tooltip-avatar-placeholder" aria-hidden="true">
                          {reactorName.charAt(0).toUpperCase()}
                        </div>
                      {/if}
                      <span class="reactor-tooltip-name">{reactorName}</span>
                    </div>
                  {/each}
                  {#if chip.reactorIds.length > REACTOR_TOOLTIP_LIMIT}
                    <div class="reactor-tooltip-more">
                      {$t('messaging.message.reactorsMore', { values: { count: chip.reactorIds.length - REACTOR_TOOLTIP_LIMIT } })}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#if menuOpen}
    <div
      class="message-actions-popover"
      bind:this={popoverEl}
      style="left: {menuX}px; top: {menuY}px;"
      role="menu"
      aria-label={$t('messaging.message.actionsAria')}
      on:pointerdown|stopPropagation
      on:keydown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (pickerExpanded) {
            collapsePicker();
          } else {
            closeMenu();
          }
        }
      }}
      tabindex="-1"
    >
      {#if !pickerExpanded}
        <div class="quick-reaction-bar" role="group" aria-label={$t('messaging.message.quickReactionsAria')}>
          {#each QUICK_REACTIONS as emoji (emoji)}
            <button
              type="button"
              class="quick-reaction-btn"
              class:own={quickReactedSet.has(emoji)}
              aria-pressed={quickReactedSet.has(emoji)}
              aria-label={$t('messaging.message.reactWithAria', { values: { emoji } })}
              title={$t('messaging.message.reactWithAria', { values: { emoji } })}
              on:click={() => handleQuickReact(emoji)}
            >
              {emoji}
            </button>
          {/each}
          <button
            type="button"
            class="quick-reaction-expand"
            aria-label={$t('messaging.message.moreReactionsAria')}
            title={$t('messaging.message.moreReactionsAria')}
            on:click={expandPicker}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
        <MessageActionsMenu
          messageId={id}
          text={displayContent}
          on:copy={handleMenuCopy}
          on:reply={handleMenuReply}
        />
      {:else}
        <div class="reaction-picker-expanded" role="dialog" aria-label={$t('messaging.message.chooseReactionAria')}>
          <div class="reaction-picker-search">
            <button
              type="button"
              class="reaction-picker-back"
              aria-label={$t('messaging.message.backAria')}
              title={$t('messaging.message.backAria')}
              on:click={collapsePicker}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <input
              type="text"
              class="reaction-picker-input"
              placeholder={$t('messaging.message.searchEmojiPlaceholder')}
              aria-label={$t('messaging.message.searchEmojiPlaceholder')}
              bind:value={emojiSearchQuery}
            />
          </div>
          <div class="reaction-picker-scroll">
            {#if !emojiSearchQuery.trim()}
              <div class="reaction-picker-section">
                <span class="reaction-picker-section-title">{$t('messaging.message.frequentlyUsed')}</span>
                <div class="reaction-picker-grid">
                  {#each COMMON_REACTIONS as emoji (emoji)}
                    <button
                      type="button"
                      class="reaction-picker-emoji"
                      aria-label={$t('messaging.message.reactWithAria', { values: { emoji } })}
                      title={$t('messaging.message.reactWithAria', { values: { emoji } })}
                      on:click={() => handlePickerSelect(emoji)}
                    >
                      {emoji}
                    </button>
                  {/each}
                  {#each recentEmojis as emoji (emoji)}
                    {#if !COMMON_REACTIONS.includes(emoji)}
                      <button
                        type="button"
                        class="reaction-picker-emoji"
                        aria-label={$t('messaging.message.reactWithAria', { values: { emoji } })}
                        title={$t('messaging.message.reactWithAria', { values: { emoji } })}
                        on:click={() => handlePickerSelect(emoji)}
                      >
                        {emoji}
                      </button>
                    {/if}
                  {/each}
                </div>
              </div>
              <div class="reaction-picker-section">
                <span class="reaction-picker-section-title">{$t('messaging.message.allEmoji')}</span>
                <div class="reaction-picker-grid">
                  {#each EMOJI_GRID_ALL as emoji (emoji)}
                    <button
                      type="button"
                      class="reaction-picker-emoji"
                      aria-label={$t('messaging.message.reactWithAria', { values: { emoji } })}
                      title={$t('messaging.message.reactWithAria', { values: { emoji } })}
                      on:click={() => handlePickerSelect(emoji)}
                    >
                      {emoji}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
            {#if emojiSearchResults.length > 0}
              <div class="reaction-picker-grid">
                {#each emojiSearchResults as entry (entry.emoji)}
                  <button
                    type="button"
                    class="reaction-picker-emoji"
                    aria-label={$t('messaging.message.reactWithNamedAria', { values: { emoji: entry.emoji, name: entry.name } })}
                    title={entry.name}
                    on:click={() => handlePickerSelect(entry.emoji)}
                  >
                    {entry.emoji}
                  </button>
                {/each}
              </div>
            {:else if emojiSearchQuery.trim()}
              <div class="reaction-picker-empty">{$t('messaging.message.noMatchingEmoji')}</div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .message {
    display: flex;
    gap: 16px;
    padding: 8px 16px;
    transition: background 0.1s;
    position: relative;
  }

  .message.mentioned {
    background: rgba(88, 101, 242, 0.12);
  }

  .message.compact {
    padding-top: 2px;
    padding-bottom: 2px;
  }

  .message:hover {
    background: var(--bg-hover);
  }

  .avatar {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .message.compact .avatar {
    height: auto;
    min-height: 0;
    margin-top: 0;
  }

  .avatar img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .avatar-placeholder {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    font-weight: 600;
    font-size: 1rem;
  }

  .message-content {
    flex: 1;
    min-width: 0;
  }

  .message-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 2px;
  }

  .author-name {
    color: var(--text-primary);
    font-weight: 500;
    font-size: 0.9375rem;
  }

  .timestamp {
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 400;
  }

  .message-options-btn {
    margin-left: auto;
    padding: 2px 6px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.1s, background 0.1s;
  }

  .message:hover .message-options-btn,
  .message-options-btn:focus-visible {
    opacity: 1;
  }

  .message-options-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .msg-reply {
    margin-bottom: 6px;
    padding-left: 10px;
    border-left: 3px solid var(--reply-border, var(--accent));
    color: var(--text-muted);
    font-size: 0.8125rem;
    line-height: 1.3;
  }

  .msg-reply-inner {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }

  .msg-reply-inner:hover {
    color: var(--text-secondary);
  }

  .msg-reply-author {
    font-weight: 500;
    color: var(--text-secondary);
  }

  .msg-reply-preview {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }

  .message-body {
    position: relative;
  }

  .message-text {
    color: var(--text-secondary);
    font-size: 0.9375rem;
    line-height: 1.375rem;
    word-wrap: break-word;
  }

  .structured-notice {
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .message-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
  }

  .message-reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }

  /* Telegram-style: reactions inset onto the bottom-left corner of the trailing
     image/video tile instead of floating as a disconnected row below it. */
  .message-reactions.overlay-media {
    position: absolute;
    left: 10px;
    bottom: 10px;
    margin-top: 0;
    z-index: 2;
  }

  .message-reactions.overlay-media .reaction-chip {
    background: rgba(24, 26, 32, 0.82);
    backdrop-filter: blur(4px);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  }

  .message-reactions.overlay-media .reaction-chip:hover {
    background: rgba(24, 26, 32, 0.95);
  }

  .message-reactions.overlay-media .reaction-chip.own {
    background: rgba(88, 101, 242, 0.55);
  }

  .reaction-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    color: var(--text-secondary);
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
  }

  .reaction-chip:hover {
    background: var(--bg-hover);
  }

  .reaction-chip.own {
    background: rgba(88, 101, 242, 0.18);
    border-color: var(--accent);
  }

  .reaction-count {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .reaction-chip-wrap {
    position: relative;
    display: inline-flex;
  }

  .reactor-tooltip {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 160px;
    max-width: 240px;
    max-height: 220px;
    overflow-y: auto;
    padding: 8px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  .reactor-tooltip-entry {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .reactor-tooltip-avatar {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border-radius: 50%;
    object-fit: cover;
  }

  .reactor-tooltip-avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: #ffffff;
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .reactor-tooltip-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--text-primary);
    font-size: 0.8125rem;
  }

  .reactor-tooltip-more {
    margin-top: 2px;
    padding-top: 4px;
    border-top: 1px solid var(--border-subtle);
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .message-actions-popover {
    position: fixed;
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .quick-reaction-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 8px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    align-self: flex-start;
  }

  .quick-reaction-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
    background: none;
    border: none;
    border-radius: 50%;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    transition: background 0.12s, transform 0.12s;
  }

  .quick-reaction-btn:hover {
    background: var(--bg-hover);
    transform: scale(1.12);
  }

  .quick-reaction-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .quick-reaction-btn.own {
    background: rgba(88, 101, 242, 0.18);
  }

  .quick-reaction-expand {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    margin-left: 2px;
    padding: 0;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    border-radius: 50%;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .quick-reaction-expand:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .quick-reaction-expand:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .reaction-picker-expanded {
    display: flex;
    flex-direction: column;
    width: 256px;
    max-height: 320px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .reaction-picker-search {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }

  .reaction-picker-back {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    padding: 0;
    background: none;
    border: none;
    border-radius: 6px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .reaction-picker-back:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .reaction-picker-input {
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 0.875rem;
    outline: none;
  }

  .reaction-picker-input:focus {
    border-color: var(--accent);
  }

  .reaction-picker-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .reaction-picker-section {
    margin-bottom: 8px;
  }

  .reaction-picker-section-title {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 6px;
    padding: 0 4px;
  }

  .reaction-picker-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
  }

  .reaction-picker-emoji {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    padding: 0;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    font-size: 1.25rem;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
  }

  .reaction-picker-emoji:hover {
    background: var(--bg-hover);
    border-color: var(--border);
  }

  .reaction-picker-emoji:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .reaction-picker-empty {
    padding: 12px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>
