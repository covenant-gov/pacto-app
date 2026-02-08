<script lang="ts">
  export let channelName: string = "";
  export let onSend: (content: string) => void = () => {};
  /** Optional: called when user types (e.g. to send typing indicator). */
  export let onTyping: (() => void) | undefined = undefined;
  /** When true, input and send are disabled (e.g. channel still being created). */
  export let disabled: boolean = false;

  let messageText = "";

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
      handleSubmit(event);
    } else {
      onTyping?.();
    }
  }

  function handleInput() {
    onTyping?.();
  }
</script>

<div class="message-input-container" class:disabled>
  <form on:submit={handleSubmit}>
    <div class="input-wrapper">
      <input
        type="text"
        bind:value={messageText}
        on:keydown={handleKeydown}
        on:input={handleInput}
        placeholder="Message #{channelName}"
        class="message-input"
        autocomplete="off"
        {disabled}
      />
      <button 
        type="submit" 
        class="send-button" 
        disabled={disabled || !messageText.trim()}
        aria-label="Send message"
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
  }

  .input-wrapper:focus-within {
    background: var(--border);
  }

  .message-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    padding: 12px 0;
    font-family: inherit;
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

