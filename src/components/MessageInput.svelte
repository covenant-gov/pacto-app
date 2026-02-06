<script lang="ts">
  export let channelName: string = "";
  export let onSend: (content: string) => void = () => {};
  /** Optional: called when user types (e.g. to send typing indicator). */
  export let onTyping: (() => void) | undefined = undefined;

  let messageText = "";

  function handleSubmit(event: Event) {
    event.preventDefault();
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

<div class="message-input-container">
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
      />
      <button 
        type="submit" 
        class="send-button" 
        disabled={!messageText.trim()}
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
    background: #313338;
  }

  form {
    width: 100%;
  }

  .input-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #383a40;
    border-radius: 8px;
    padding: 0 16px;
    transition: background 0.15s;
  }

  .input-wrapper:focus-within {
    background: #404249;
  }

  .message-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #dbdee1;
    font-size: 0.9375rem;
    padding: 12px 0;
    font-family: inherit;
  }

  .message-input::placeholder {
    color: #6d6f78;
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
    color: #949ba4;
    transition: color 0.15s;
  }

  .send-button:hover:not(:disabled) {
    color: #f2f3f5;
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

