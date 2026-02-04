<script lang="ts">
  import { activeDmId, composingNewChat } from '../stores/app';
  import { sendDmMessage } from '../lib/api/nostr';
  import { getInvokeErrorMessage, friendlyMessage } from '../lib/utils/tauri-errors';

  let npub = '';
  let messageText = '';
  let sending = false;
  let error: string | null = null;

  async function handleSend() {
    const trimmedNpub = npub.trim();
    const trimmedContent = messageText.trim();
    if (!trimmedNpub || !trimmedContent) return;

    error = null;
    sending = true;
    try {
      const ok = await sendDmMessage(trimmedNpub, trimmedContent);
      if (ok) {
        $activeDmId = trimmedNpub;
        $composingNewChat = false;
        npub = '';
        messageText = '';
      } else {
        error = 'Could not deliver to relays. Message may appear as pending or failed.';
      }
    } catch (e: unknown) {
      const raw = getInvokeErrorMessage(e, 'Failed to send message');
      error = friendlyMessage(raw, 'dm_send');
      if (import.meta.env.DEV) console.error('[DM send error]', e);
    } finally {
      sending = false;
    }
  }

  function handleCancel() {
    $composingNewChat = false;
    npub = '';
    messageText = '';
    error = null;
  }

  $: canSend = npub.trim().length > 0 && messageText.trim().length > 0 && !sending;
</script>

<div class="messenger-chat-view">
  <div class="header">
    <h2 class="title">New Chat</h2>
    <p class="subtitle">Enter their npub and a message to start a conversation</p>
  </div>

  <form class="form" on:submit|preventDefault={handleSend}>
    <label class="label" for="npub-input">Recipient (npub)</label>
    <input
      id="npub-input"
      type="text"
      class="input"
      placeholder="npub1..."
      bind:value={npub}
      disabled={sending}
      autocomplete="off"
    />

    <label class="label" for="message-input">Message</label>
    <textarea
      id="message-input"
      class="textarea"
      placeholder="Type a message..."
      bind:value={messageText}
      disabled={sending}
      rows="4"
    ></textarea>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <div class="actions">
      <button type="button" class="btn btn-secondary" on:click={handleCancel} disabled={sending}>
        Cancel
      </button>
      <button type="submit" class="btn btn-primary" disabled={!canSend}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  </form>
</div>

<style>
  .messenger-chat-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background-color: #313338;
  }

  .header {
    padding: 24px 24px 16px;
    border-bottom: 1px solid #1e1f22;
  }

  .title {
    font-size: 1.25rem;
    font-weight: 600;
    color: #f2f3f5;
    margin: 0 0 4px;
  }

  .subtitle {
    font-size: 0.875rem;
    color: #b5bac1;
    margin: 0;
  }

  .form {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 480px;
  }

  .label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #b5bac1;
    display: block;
  }

  .input,
  .textarea {
    width: 100%;
    padding: 10px 12px;
    font-size: 0.9375rem;
    color: #f2f3f5;
    background-color: #383a40;
    border: 1px solid #1e1f22;
    border-radius: 4px;
    outline: none;
    font-family: inherit;
  }

  .input:focus,
  .textarea:focus {
    border-color: #5865f2;
  }

  .input::placeholder,
  .textarea::placeholder {
    color: #6d6f78;
  }

  .textarea {
    resize: vertical;
    min-height: 80px;
  }

  .error {
    font-size: 0.875rem;
    color: #ed4245;
    margin: 0;
  }

  .actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 8px;
  }

  .btn {
    padding: 8px 16px;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    outline: none;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background-color: #4e5058;
    color: #f2f3f5;
  }

  .btn-secondary:hover:not(:disabled) {
    background-color: #5d5f69;
  }

  .btn-primary {
    background-color: #5865f2;
    color: #ffffff;
  }

  .btn-primary:hover:not(:disabled) {
    background-color: #4752c4;
  }
</style>
