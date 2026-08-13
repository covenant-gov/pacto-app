<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { activeDmId, activeDmTab, composingNewChat, addPendingDm, backendDmMessages, dmSendError, newChatDraftNpub, newChatDraftMessage } from '../../stores/app';
  import { sendDmMessage } from '../../lib/api/nostr';
  import { getInvokeErrorMessage, friendlyMessage } from '../../lib/utils/tauri-errors';
  import { dmLog, dmError } from '../../lib/utils/dm-debug';
  import { isValidNpub } from '../../lib/utils/npub';
  import { t } from 'svelte-i18n';

  const tFn = get(t);

  let npub = '';
  let messageText = '';
  let sending = false;

  // Consume any prefill (e.g. a "Request DM" from a Commons user card), then clear it.
  onMount(() => {
    const draftNpub = get(newChatDraftNpub);
    const draftMessage = get(newChatDraftMessage);
    if (draftNpub) npub = draftNpub;
    if (draftMessage) messageText = draftMessage;
    newChatDraftNpub.set('');
    newChatDraftMessage.set('');
  });

  async function handleSend() {
    const trimmedNpub = npub.trim();
    const trimmedContent = messageText.trim();
    if (!trimmedNpub || !trimmedContent) return;

    if (!isValidNpub(trimmedNpub)) {
      $dmSendError = tFn('messaging.dm.newChat.invalidNpub');
      return;
    }

    $dmSendError = null;

    dmLog('MessengerChatView handleSend (new chat)', {
      npub: trimmedNpub.slice(0, 24) + '…',
      contentLen: trimmedContent.length,
    });

    sending = true;

    // Optimistic UI: switch to the conversation immediately so the sender sees the thread
    // while the backend sends (backend emits message_new early; recipient gets it quickly).
    $activeDmId = trimmedNpub;
    $composingNewChat = false;
    const contentToSend = trimmedContent;
    npub = '';
    messageText = '';

    // Ensure the new chat appears in Pending (we sent first; moves to Friends when they reply)
    addPendingDm(trimmedNpub);
    activeDmTab.set('pending');
    dmLog('MessengerChatView: added to Pending, optimistic message');

    // Add optimistic message so the sender sees their message immediately
    const optimisticId = `opt-${Date.now()}`;
    backendDmMessages.update((byNpub) => {
      const list = byNpub[trimmedNpub] ?? [];
      return {
        ...byNpub,
        [trimmedNpub]: [...list, { id: optimisticId, content: contentToSend, at: Date.now(), mine: true }],
      };
    });

    try {
      const ok = await sendDmMessage(trimmedNpub, contentToSend);
      dmLog('MessengerChatView sendDmMessage result', { ok });
      if (!ok) {
        $dmSendError = tFn('messaging.dm.newChat.deliverError');
      }
    } catch (e: unknown) {
      const raw = getInvokeErrorMessage(e, 'Failed to send message');
      $dmSendError = friendlyMessage(raw, 'dm_send');
      dmError('MessengerChatView send error', e);
    } finally {
      sending = false;
    }
  }

  function handleCancel() {
    $composingNewChat = false;
    npub = '';
    messageText = '';
    $dmSendError = null;
  }

  $: canSend = isValidNpub(npub.trim()) && messageText.trim().length > 0 && !sending;
</script>

<div class="messenger-chat-view">
  <div class="header">
    <h2 class="title">{$t('messaging.dm.newChat.title')}</h2>
    <p class="subtitle">{$t('messaging.dm.newChat.subtitle')}</p>
  </div>

  <form class="form" on:submit|preventDefault={handleSend}>
    <label class="label" for="npub-input">{$t('messaging.dm.newChat.recipientLabel')}</label>
    <input
      id="npub-input"
      type="text"
      class="input"
      placeholder={$t('messaging.dm.newChat.recipientPlaceholder')}
      bind:value={npub}
      disabled={sending}
      autocomplete="off"
      aria-invalid={npub.trim().length > 0 && !isValidNpub(npub.trim())}
      aria-describedby={npub.trim().length > 0 && !isValidNpub(npub.trim()) ? 'npub-hint' : undefined}
    />
    {#if npub.trim().length > 0 && !isValidNpub(npub.trim())}
      <p id="npub-hint" class="hint" role="status">{$t('messaging.dm.newChat.npubHint')}</p>
    {/if}

    <label class="label" for="message-input">{$t('messaging.dm.newChat.messageLabel')}</label>
    <textarea
      id="message-input"
      class="textarea"
      placeholder={$t('messaging.dm.newChat.messagePlaceholder')}
      bind:value={messageText}
      disabled={sending}
      rows="4"
    ></textarea>

    {#if $dmSendError}
      <p class="error" role="alert">{$dmSendError}</p>
    {/if}

    <div class="actions">
      <button type="button" class="btn btn-secondary" on:click={handleCancel} disabled={sending}>
        {$t('messaging.dm.newChat.cancel')}
      </button>
      <button type="submit" class="btn btn-primary" disabled={!canSend}>
        {sending ? $t('messaging.dm.newChat.sending') : $t('messaging.dm.newChat.send')}
      </button>
    </div>
  </form>
</div>

<style>
  .messenger-chat-view {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background-color: var(--border-subtle);
  }

  .header {
    padding: 24px 24px 16px;
    border-bottom: 1px solid var(--bg-elevated);
  }

  .title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 4px;
  }

  .subtitle {
    font-size: 0.875rem;
    color: var(--text-secondary);
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
    color: var(--text-secondary);
    display: block;
  }

  .input,
  .textarea {
    width: 100%;
    padding: 10px 12px;
    font-size: 0.9375rem;
    color: var(--text-primary);
    background-color: var(--bg-hover);
    border: 1px solid var(--bg-elevated);
    border-radius: 4px;
    outline: none;
    font-family: inherit;
  }

  .input:focus,
  .textarea:focus {
    border-color: var(--brand);
  }

  .input::placeholder,
  .textarea::placeholder {
    color: var(--text-muted);
  }

  .hint {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin: -8px 0 0;
  }

  .textarea {
    resize: vertical;
    min-height: 80px;
  }

  .error {
    font-size: 0.875rem;
    color: var(--danger);
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
    background-color: var(--border);
    color: var(--text-primary);
  }

  .btn-secondary:hover:not(:disabled) {
    background-color: var(--bg-hover);
  }

  .btn-primary {
    background-color: var(--brand);
    color: var(--on-brand);
  }

  .btn-primary:hover:not(:disabled) {
    background-color: var(--brand-hover);
  }
</style>
