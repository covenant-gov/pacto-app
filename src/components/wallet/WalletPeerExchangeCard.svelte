<script lang="ts">
  /**
   * Thread card for private wallet-address exchange (request / grant / decline).
   * Structured content is still parsed for persistence; this is the human-visible summary.
   */
  export let variant:
    | 'request-in'
    | 'request-out'
    | 'grant-in'
    | 'grant-out'
    | 'decline-in'
    | 'decline-out';
  export let peerName: string;
  /** For request-in only. */
  export let status: 'pending' | 'accepted' | 'declined' = 'pending';
  export let accepting = false;
  export let onAccept: (() => void) | undefined = undefined;
  export let onDecline: (() => void) | undefined = undefined;

  $: title = (() => {
    switch (variant) {
      case 'request-in':
        return 'Wallet information request';
      case 'request-out':
        return 'Wallet info request sent';
      case 'grant-in':
        return 'Wallet information shared';
      case 'grant-out':
        return 'You shared your wallet address';
      case 'decline-in':
        return 'Wallet request declined';
      case 'decline-out':
        return 'You declined';
      default:
        return 'Wallet';
    }
  })();

  $: body = (() => {
    switch (variant) {
      case 'request-in':
        return `${peerName} asked to exchange payout addresses so you can send assets in this chat. Your address is only stored on each of your devices if you accept.`;
      case 'request-out':
        return `Waiting for ${peerName} to accept or decline.`;
      case 'grant-in':
        return `${peerName} accepted. You can use Send or Request in the wallet sidebar.`;
      case 'grant-out':
        return `${peerName} can now send to your embedded wallet address for this chat.`;
      case 'decline-in':
        return `${peerName} declined to share a wallet address.`;
      case 'decline-out':
        return `You chose not to share your wallet address with ${peerName}.`;
      default:
        return '';
    }
  })();

  $: collapsed = variant === 'request-in' && (status === 'accepted' || status === 'declined');
</script>

<div class="wpeer-card" class:collapsed role="article">
  <div class="wpeer-icon" aria-hidden="true">◈</div>
  <div class="wpeer-body">
    <p class="wpeer-title">{title}</p>
    {#if !collapsed || variant !== 'request-in'}
      <p class="wpeer-text">{body}</p>
    {/if}
    {#if variant === 'request-in'}
      {#if status === 'accepted'}
        <p class="wpeer-status wpeer-ok" aria-live="polite">Accepted</p>
      {:else if status === 'declined'}
        <p class="wpeer-status wpeer-no" aria-live="polite">Declined</p>
      {:else}
        <div class="wpeer-actions">
          <button
            type="button"
            class="wpeer-btn wpeer-accept"
            disabled={accepting}
            on:click={() => onAccept?.()}
          >
            {accepting ? 'Accepting…' : 'Accept'}
          </button>
          <button
            type="button"
            class="wpeer-btn wpeer-decline"
            disabled={accepting}
            on:click={() => onDecline?.()}
          >
            Decline
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .wpeer-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin: 8px 16px;
    padding: 12px 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    max-width: 380px;
    border-left: 3px solid var(--accent, #6c5ce7);
  }

  .wpeer-card.collapsed {
    align-items: center;
    padding: 8px 14px;
  }

  .wpeer-icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: var(--bg-panel);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    color: var(--text-primary);
  }

  .wpeer-body {
    flex: 1;
    min-width: 0;
  }

  .wpeer-title {
    margin: 0 0 6px;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .wpeer-text {
    margin: 0 0 10px;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .wpeer-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .wpeer-btn {
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-primary);
  }

  .wpeer-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .wpeer-accept {
    background: var(--accent, #6c5ce7);
    color: #fff;
    border-color: transparent;
  }

  .wpeer-decline {
    background: transparent;
  }

  .wpeer-status {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .wpeer-ok {
    color: var(--success, #27ae60);
  }

  .wpeer-no {
    color: var(--text-secondary);
  }
</style>
