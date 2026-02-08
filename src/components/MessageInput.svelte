<script lang="ts">
  import { tick } from 'svelte';
  import smileFaceIcon from '../icons/smile-face.svg';
  import { getEmojiList, recentEmojisStore, addToRecentEmojis, searchEmojis } from '../stores/emojis';

  export let channelName: string = "";
  export let onSend: (content: string) => void = () => {};
  /** Optional: called when user types (e.g. to send typing indicator). */
  export let onTyping: (() => void) | undefined = undefined;
  /** When true, input and send are disabled (e.g. channel still being created). */
  export let disabled: boolean = false;

  let messageText = "";
  let textareaEl: HTMLTextAreaElement | undefined;
  let emojiPickerOpen = false;
  let emojiPickerEl: HTMLDivElement | undefined;
  let emojiSearchQuery = "";

  const fullEmojiList = getEmojiList();
  const EMOJI_GRID = fullEmojiList.map((e) => e.emoji);
  $: recentEmojis = $recentEmojisStore;
  $: searchResults = emojiSearchQuery.trim() ? searchEmojis(emojiSearchQuery.trim()) : [];

  function handleSubmit(event: Event) {
    event.preventDefault();
    if (disabled) return;
    if (messageText.trim()) {
      onSend(messageText);
      messageText = "";
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      handleSubmit(event);
    } else if (event.key === 'Enter' && event.shiftKey) {
      // Allow default: insert newline in textarea (do not send)
    } else {
      onTyping?.();
    }
  }

  function handleInput() {
    onTyping?.();
  }

  async function insertEmoji(emoji: string) {
    const ta = textareaEl;
    const start = ta ? (ta.selectionStart ?? messageText.length) : messageText.length;
    const end = ta ? (ta.selectionEnd ?? messageText.length) : messageText.length;
    messageText = messageText.slice(0, start) + emoji + messageText.slice(end);
    const entry = fullEmojiList.find((e) => e.emoji === emoji);
    if (entry) addToRecentEmojis(entry);
    emojiPickerOpen = false;
    onTyping?.();
    await tick();
    if (textareaEl) {
      textareaEl.focus();
      const pos = start + emoji.length;
      textareaEl.setSelectionRange(pos, pos);
    }
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as Node;
    if (emojiPickerOpen && emojiPickerEl && !emojiPickerEl.contains(target) && !(event.target as HTMLElement)?.closest?.('.emoji-trigger-btn')) {
      emojiPickerOpen = false;
    }
  }
</script>

<svelte:window on:click={handleClickOutside} />

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
        on:click={() => {
          emojiPickerOpen = !emojiPickerOpen;
          if (emojiPickerOpen) emojiSearchQuery = '';
        }}
      >
        <img src={smileFaceIcon} alt="" width="20" height="20" />
      </button>
      <textarea
        bind:this={textareaEl}
        bind:value={messageText}
        on:keydown={handleKeydown}
        on:input={handleInput}
        placeholder="Message #{channelName}"
        class="message-input"
        rows="1"
        {disabled}
      ></textarea>
      {#if emojiPickerOpen}
        <div
          class="emoji-picker"
          bind:this={emojiPickerEl}
          role="dialog"
          aria-label="Emoji picker"
        >
          <div class="emoji-picker-search">
            <input
              type="text"
              class="emoji-search-input"
              placeholder="Search emoji…"
              bind:value={emojiSearchQuery}
              on:click|stopPropagation
              on:keydown|stopPropagation
              aria-label="Search emoji"
            />
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
              {#if recentEmojis.length > 0}
                <span class="emoji-picker-label">Smileys &amp; more</span>
              {/if}
              <div class="emoji-picker-grid">
                {#each EMOJI_GRID as emoji}
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
            </div>
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
    flex-shrink: 0;
  }

  .emoji-search-input {
    width: 100%;
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

  .emoji-picker-empty {
    margin: 0;
    padding: 12px 0;
    font-size: 0.8125rem;
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
</style>

