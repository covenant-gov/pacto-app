<script lang="ts">
  import { tick } from 'svelte';
  import smileFaceIcon from '../../icons/smile-face.svg';
  import { getEmojiList, recentEmojisStore, addToRecentEmojis, searchEmojis } from '../../stores/emojis';
  import {
    buildMentionCandidates,
    filterMentionCandidates,
    findActiveAtTrigger,
    replaceAtTrigger,
    type MentionCandidate,
  } from '../../lib/messaging/mention-autocomplete';
  import type { NostrProfile } from '../../lib/api/nostr';
  import type { Mention } from '../../lib/messaging/mentions';

  export let channelName: string = "";
  /** When set, replaces the default `Message #{channelName}` placeholder (e.g. blocked peer). */
  export let placeholderOverride: string | undefined = undefined;
  export let onSend: (content: string) => void = () => {};
  /** Optional: called for squad channels with a body + mention list so the caller can build the envelope. */
  export let onSendMentions: ((body: string, mentions: Mention[]) => void) | undefined = undefined;
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

  $: inputPlaceholder = placeholderOverride ?? `Message #${channelName}`;
  const fullEmojiList = getEmojiList();

  let messageText = "";
  let textareaEl: HTMLTextAreaElement | undefined;
  let emojiPickerOpen = false;
  let emojiSearchQuery = "";

  // Mention picker state
  let mentionPickerOpen = false;
  let mentionQuery = "";
  let mentionSelectedIndex = 0;
  let mentionStartIndex = 0;
  let mentionEndIndex = 0;
  let mentions: Mention[] = [];

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
    emojiPickerOpen = false;
    emojiSearchQuery = '';
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

  function handleSubmit(event: Event) {
    event.preventDefault();
    if (disabled) return;
    if (mentionPickerOpen && filteredMentions[mentionSelectedIndex]) {
      void selectMention(filteredMentions[mentionSelectedIndex]);
      return;
    }
    const body = messageText.trim();
    if (!body) return;
    const pruned = removeStaleMentions(body);
    if (onSendMentions && squadMlsGroupId) {
      onSendMentions(body, pruned);
    } else {
      onSend(body);
    }
    messageText = "";
    mentions = [];
    closeMentionPicker();
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
    openMentionPickerAtCursor();
    onTyping?.();
  }

  function getMentionPickerStyle(): string {
    if (!textareaEl) return '';
    const beforeText = messageText.slice(0, mentionStartIndex + 1);
    const clone = document.createElement('div');
    const computed = window.getComputedStyle(textareaEl);
    clone.style.cssText = `
      position: absolute;
      visibility: hidden;
      white-space: pre-wrap;
      word-wrap: break-word;
      width: ${textareaEl.clientWidth}px;
      font: ${computed.font};
      line-height: ${computed.lineHeight};
      padding: ${computed.paddingTop} ${computed.paddingRight} ${computed.paddingBottom} ${computed.paddingLeft};
      border: ${computed.borderWidth} solid transparent;
    `;
    clone.textContent = beforeText;
    document.body.appendChild(clone);
    const rect = textareaEl.getBoundingClientRect();
    const cloneRect = clone.getBoundingClientRect();
    document.body.removeChild(clone);

    const cursorTop = rect.top + Math.min(cloneRect.height, textareaEl.clientHeight);
    const pickerHeight = 240; // matches .mention-picker max-height
    const viewportHeight = window.innerHeight;
    const fitsBelow = cursorTop + pickerHeight <= viewportHeight;
    const top = fitsBelow ? cursorTop : Math.max(8, rect.top - pickerHeight);
    return `position: fixed; top: ${top}px; left: ${rect.left}px;`;
  }
  /** Cap browse/search so opening the picker does not mount ~1k+ buttons and freeze the UI. */
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
    await closeEmojiPicker({ refocusComposer: true });
    onTyping?.();
    await tick();
    if (textareaEl) {
      const pos = start + emoji.length;
      textareaEl.setSelectionRange(pos, pos);
    }
  }

  async function closeEmojiPicker(opts?: { refocusComposer?: boolean }) {
    emojiPickerOpen = false;
    emojiSearchQuery = '';
    if (opts?.refocusComposer) {
      await tick();
      textareaEl?.focus();
    }
  }

  function toggleEmojiPicker(event: MouseEvent) {
    event.stopPropagation();
    if (emojiPickerOpen) {
      void closeEmojiPicker();
      return;
    }
    emojiSearchQuery = '';
    emojiPickerOpen = true;
  }

  function handleEmojiSearchKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      void closeEmojiPicker({ refocusComposer: true });
    }
  }

  function handleClickOutside(event: MouseEvent) {
    if (!emojiPickerOpen) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest?.('.emoji-picker') || target.closest?.('.emoji-trigger-btn')) return;
    void closeEmojiPicker();
  }
</script>

<svelte:window on:pointerdown={handleClickOutside} />

<div class="message-input-container" class:disabled>
  <form on:submit|preventDefault={handleSubmit}>
    <div class="input-wrapper">
      <button
        type="button"
        class="emoji-trigger-btn"
        disabled={disabled}
        aria-label="Insert emoji"
        aria-expanded={emojiPickerOpen}
        aria-haspopup="grid"
        title="Insert emoji"
        on:click={toggleEmojiPicker}
      >
        <img src={smileFaceIcon} alt="" width="20" height="20" />
      </button>
      <textarea
        bind:this={textareaEl}
        bind:value={messageText}
        on:keydown={handleKeydown}
        on:input={handleInput}
        placeholder={inputPlaceholder}
        class="message-input"
        rows="1"
        {disabled}
      ></textarea>
      {#if emojiPickerOpen && !disabled}
        <div
          class="emoji-picker"
          role="dialog"
          aria-label="Emoji picker"
          on:pointerdown|stopPropagation
        >
          <div class="emoji-picker-search">
            <input
              type="text"
              class="emoji-search-input"
              placeholder="Search emoji…"
              bind:value={emojiSearchQuery}
              on:click|stopPropagation
              on:keydown={handleEmojiSearchKeydown}
              aria-label="Search emoji"
            />
            <button
              type="button"
              class="emoji-picker-close"
              aria-label="Close emoji picker"
              title="Close"
              on:click|stopPropagation={() => closeEmojiPicker({ refocusComposer: true })}
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
          {#if emojiSearchQuery.trim()}
            <div class="emoji-picker-section">
              {#if searchResults.length > 0}
                <div class="emoji-picker-grid">
                  {#each searchResults as entry (entry.emoji)}
                    <button
                      type="button"
                      class="emoji-picker-item"
                      role="gridcell"
                      aria-label="Insert {entry.emoji}"
                      on:click={() => insertEmoji(entry.emoji)}
                    >
                      {entry.emoji}
                    </button>
                  {/each}
                </div>
                {#if searchResults.length >= EMOJI_SEARCH_LIMIT}
                  <p class="emoji-picker-hint">Showing top {EMOJI_SEARCH_LIMIT} matches — refine your search</p>
                {/if}
              {:else}
                <p class="emoji-picker-empty">No emojis found for "{emojiSearchQuery.trim()}"</p>
              {/if}
            </div>
          {:else}
            {#if recentEmojis.length > 0}
              <div class="emoji-picker-section">
                <span class="emoji-picker-label">Recent</span>
                <div class="emoji-picker-row">
                  {#each recentEmojis as entry (entry.emoji)}
                    <button
                      type="button"
                      class="emoji-picker-item"
                      role="gridcell"
                      aria-label="Insert {entry.emoji}"
                      on:click={() => insertEmoji(entry.emoji)}
                    >
                      {entry.emoji}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
            <div class="emoji-picker-section">
              <span class="emoji-picker-label">Smileys &amp; more</span>
              <div class="emoji-picker-grid">
                {#each EMOJI_GRID_BROWSE as emoji (emoji)}
                  <button
                    type="button"
                    class="emoji-picker-item"
                    role="gridcell"
                    aria-label="Insert {emoji}"
                    on:click={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                {/each}
              </div>
              <p class="emoji-picker-hint">Search for more emojis</p>
            </div>
          {/if}
        </div>
      {/if}
      {#if mentionPickerOpen && !disabled}
        <div
          class="mention-picker"
          role="dialog"
          aria-label="Mention member"
          style={getMentionPickerStyle()}
          on:pointerdown|stopPropagation
        >
          {#if filteredMentions.length > 0}
            <ul class="mention-list" role="listbox" aria-label="Mention candidates">
              {#each filteredMentions as candidate, i (candidate.npub)}
                <li
                  role="option"
                  aria-selected={i === mentionSelectedIndex}
                  class="mention-item"
                  class:selected={i === mentionSelectedIndex}
                  title={candidate.npub}
                  on:click|stopPropagation={() => selectMention(candidate)}
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
            <p class="mention-empty">No members found for "{mentionQuery}"</p>
          {/if}
        </div>
      {/if}
      <button
        type="button"
        class="send-button"
        disabled={disabled || !messageText.trim()}
        aria-label="Send message"
        on:click={handleSubmit}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    </div>
  </form>
</div>

<style>
  .message-input-container {
    padding: 16px;
    background: var(--border-subtle);
  }

  .message-input-container.disabled {
    opacity: 0.7;
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

  .emoji-trigger-btn {
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

  .emoji-trigger-btn:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--code-border);
  }

  .emoji-trigger-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .emoji-trigger-btn img {
    display: block;
  }

  .emoji-picker {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    max-height: 320px;
    overflow-y: auto;
    z-index: 100;
  }

  .emoji-picker-search {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    margin: -8px -8px 0;
    padding: 8px 8px 6px;
    background: var(--bg-elevated);
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
    border-color: var(--accent);
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
    grid-template-columns: repeat(10, 1fr);
    gap: 2px;
  }

  .emoji-picker-item {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    border-radius: 4px;
    font-size: 1.25rem;
    cursor: pointer;
    transition: background 0.1s;
  }

  .emoji-picker-item:hover {
    background: var(--bg-hover);
  }

  .message-input {
    flex: 1;
    min-width: 0;
    min-height: 1.4em;
    max-height: 120px;
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
    display: flex;
    flex-direction: column;
    min-width: 220px;
    max-width: 320px;
    max-height: 240px;
    overflow-y: auto;
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
</style>

