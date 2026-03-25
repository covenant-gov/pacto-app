<script lang="ts">
  import type { WalletTxRequestPayload } from '../../lib/wallet/dm-messages';
  import { getWalletNetworkDisplayName } from '../../lib/wallet/assets';

  export let payload: WalletTxRequestPayload;
  export let isMine: boolean;
  /** Display name of the counterparty (the other person in the DM). */
  export let peerDisplayName: string;
  export let status: 'pending' | 'accepted' | 'declined' | 'fulfilled';
  export let accepting: boolean;
  export let onAccept: () => void;
  export let onDecline: () => void;

  $: networkLabel = getWalletNetworkDisplayName(payload.network);
  $: title = `${payload.amount} ${payload.asset}`;
  $: subtitle = networkLabel;
  $: bodyText = isMine
    ? `You requested this payment on ${networkLabel}.`
    : `${peerDisplayName} requested you send this amount.`;
  /** Keep declined expanded so each side sees clear copy; accepted/fulfilled stay compact. */
  $: collapsed = status === 'accepted' || status === 'fulfilled';
</script>

<div
  class="wallet-tx-request-card"
  class:collapsed
  class:wallet-tx-request-card-fulfilled={status === 'fulfilled'}
  class:wallet-tx-request-card-declined={status === 'declined'}
  role="article"
>
  <div class="wallet-tx-request-icon" aria-hidden="true">
    <span class="wallet-tx-request-icon-inner">◈</span>
  </div>
  <div class="wallet-tx-request-body">
    <p class="wallet-tx-request-badge">Payment request</p>
    <p class="wallet-tx-request-title">{title}</p>
    <p class="wallet-tx-request-subtitle">{subtitle}</p>
    <p class="wallet-tx-request-text">{bodyText}</p>
    {#if status === 'fulfilled'}
      <p class="wallet-tx-request-status wallet-tx-request-status-fulfilled" aria-live="polite">
        Paid
      </p>
      {#if isMine}
        <p class="wallet-tx-request-hint">A matching transfer was posted in this chat.</p>
      {/if}
    {:else if isMine}
      <p class="wallet-tx-request-hint">Waiting for the other person to respond.</p>
    {:else if status === 'accepted'}
      <p class="wallet-tx-request-status wallet-tx-request-status-accepted" aria-live="polite">Accepted</p>
    {:else if status === 'declined'}
      <p class="wallet-tx-request-status wallet-tx-request-status-declined" aria-live="polite">Declined</p>
      {#if isMine}
        <p class="wallet-tx-request-hint wallet-tx-request-hint-declined">
          {peerDisplayName} declined this payment request. You can follow up in chat or send another request later.
        </p>
      {:else}
        <p class="wallet-tx-request-hint wallet-tx-request-hint-declined">
          You declined. No automatic message was sent to {peerDisplayName}.
        </p>
      {/if}
    {:else}
      <div class="wallet-tx-request-actions">
        <button
          type="button"
          class="wallet-tx-request-btn wallet-tx-request-btn-accept"
          disabled={accepting}
          on:click={onAccept}
        >
          {accepting ? 'Accepting…' : 'Accept'}
        </button>
        <button
          type="button"
          class="wallet-tx-request-btn wallet-tx-request-btn-decline"
          disabled={accepting}
          on:click={onDecline}
        >
          Decline
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .wallet-tx-request-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin: 8px 16px;
    padding: 12px 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    max-width: 380px;
  }

  .wallet-tx-request-card-fulfilled {
    border-left-color: var(--success);
  }

  .wallet-tx-request-card-fulfilled .wallet-tx-request-badge {
    color: var(--success);
  }

  .wallet-tx-request-card-fulfilled .wallet-tx-request-icon-inner {
    color: var(--success);
  }

  .wallet-tx-request-card-declined {
    border-left-color: var(--text-muted);
  }

  .wallet-tx-request-card-declined .wallet-tx-request-badge {
    color: var(--text-muted);
  }

  .wallet-tx-request-card-declined .wallet-tx-request-icon-inner {
    color: var(--text-muted);
  }

  .wallet-tx-request-hint-declined {
    margin-top: 6px;
  }

  .wallet-tx-request-card.collapsed {
    align-items: center;
    padding: 8px 14px;
    gap: 10px;
  }

  .wallet-tx-request-card.collapsed .wallet-tx-request-icon {
    width: 28px;
    height: 28px;
  }

  .wallet-tx-request-card.collapsed .wallet-tx-request-badge,
  .wallet-tx-request-card.collapsed .wallet-tx-request-subtitle,
  .wallet-tx-request-card.collapsed .wallet-tx-request-text,
  .wallet-tx-request-card.collapsed .wallet-tx-request-hint {
    display: none;
  }

  .wallet-tx-request-card.collapsed .wallet-tx-request-title {
    margin: 0;
    font-size: 0.9375rem;
  }

  .wallet-tx-request-card.collapsed .wallet-tx-request-status {
    margin-left: auto;
    flex-shrink: 0;
    font-size: 0.75rem;
  }

  .wallet-tx-request-icon {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: var(--bg-panel);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .wallet-tx-request-icon-inner {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--accent);
  }

  .wallet-tx-request-body {
    flex: 1;
    min-width: 0;
  }

  .wallet-tx-request-badge {
    margin: 0 0 2px 0;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
  }

  .wallet-tx-request-title {
    margin: 0 0 4px 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .wallet-tx-request-subtitle {
    margin: 0 0 4px 0;
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.3;
  }

  .wallet-tx-request-text {
    margin: 0 0 10px 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .wallet-tx-request-hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.35;
  }

  .wallet-tx-request-status {
    margin: 0;
    font-size: 0.8125rem;
  }

  .wallet-tx-request-status-accepted {
    color: var(--success);
  }

  .wallet-tx-request-status-fulfilled {
    color: var(--success);
    font-weight: 600;
  }

  .wallet-tx-request-status-declined {
    color: var(--text-muted);
  }

  .wallet-tx-request-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .wallet-tx-request-btn {
    padding: 6px 16px;
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    border: none;
  }

  .wallet-tx-request-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .wallet-tx-request-btn-accept {
    background: var(--accent);
    color: #fff;
  }

  .wallet-tx-request-btn-accept:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .wallet-tx-request-btn-decline {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .wallet-tx-request-btn-decline:hover:not(:disabled) {
    background: var(--bg-hover);
  }
</style>
