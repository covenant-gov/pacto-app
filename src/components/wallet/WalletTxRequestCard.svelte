<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { WalletTxRequestPayload } from '../../lib/wallet/dm-messages';
  import { getWalletNetworkDisplayName } from '../../lib/wallet/assets';

  export let payload: WalletTxRequestPayload;
  export let isMine: boolean;
  /** Display name of the counterparty (the other person in the DM). */
  export let peerDisplayName: string;
  export let status: 'pending' | 'declined' | 'fulfilled' | 'sending';
  export let accepting: boolean;
  export let onAccept: () => void;
  export let onDecline: () => void;

  $: networkLabel = getWalletNetworkDisplayName(payload.network);
  $: title = `${payload.amount} ${payload.asset}`;
  $: fromAddr = payload.from_evm_address.trim();
  $: fromAddrShort =
    fromAddr.length > 14 ? `${fromAddr.slice(0, 8)}…${fromAddr.slice(-6)}` : fromAddr;
  $: subtitle = `${networkLabel} · ${fromAddrShort}`;
  $: bodyText = isMine
    ? $t('wallet.requestedPaymentOn', { values: { networkLabel, fromAddrShort } })
    : $t('wallet.peerRequestedPayment', { values: { peerName: peerDisplayName, fromAddrShort } });
  /** Declined stays expanded; fulfilled compacts to amount + Paid. */
  $: collapsed = status === 'fulfilled';
</script>

<div
  class="wallet-tx-request-card"
  class:collapsed
  class:wallet-tx-request-card-fulfilled={status === 'fulfilled'}
  class:wallet-tx-request-card-declined={status === 'declined'}
  class:wallet-tx-request-card-sending={status === 'sending'}
  role="article"
>
  <div class="wallet-tx-request-icon" aria-hidden="true">
    <span class="wallet-tx-request-icon-inner">◈</span>
  </div>
  <div class="wallet-tx-request-body">
    <p class="wallet-tx-request-badge">
      {status === 'sending' ? $t('wallet.sending') : $t('wallet.paymentRequest')}
    </p>
    <p class="wallet-tx-request-title">{title}</p>
    <p class="wallet-tx-request-subtitle">{subtitle}</p>
    {#if status !== 'sending'}
      <p class="wallet-tx-request-text">{bodyText}</p>
    {/if}
    {#if status === 'sending'}
      <p class="wallet-tx-request-hint">{$t('wallet.postingToChat')}</p>
    {:else if status === 'fulfilled'}
        <p class="wallet-tx-request-status wallet-tx-request-status-fulfilled" aria-live="polite">
          {$t('wallet.paid')}
        </p>
        {#if isMine}
          <p class="wallet-tx-request-hint">{$t('wallet.matchingTransferPosted')}</p>
        {/if}
      {:else if isMine}
        <p class="wallet-tx-request-hint">{$t('wallet.waitingForResponse')}</p>
      {:else if status === 'declined'}
        <p class="wallet-tx-request-status wallet-tx-request-status-declined" aria-live="polite">{$t('wallet.declined')}</p>
        {#if isMine}
          <p class="wallet-tx-request-hint wallet-tx-request-hint-declined">
            {$t('wallet.peerDeclinedRequest', { values: { peerName: peerDisplayName } })}
          </p>
        {:else}
          <p class="wallet-tx-request-hint wallet-tx-request-hint-declined">
            {$t('wallet.youDeclinedRequest', { values: { peerName: peerDisplayName } })}
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
            {accepting ? $t('wallet.accepting') : $t('wallet.accept')}
          </button>
          <button
            type="button"
            class="wallet-tx-request-btn wallet-tx-request-btn-decline"
            disabled={accepting}
            on:click={onDecline}
          >
            {$t('wallet.decline')}
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
    border-left: 3px solid var(--brand);
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

  .wallet-tx-request-card-sending {
    border-left-color: var(--text-muted);
    opacity: 0.92;
  }

  .wallet-tx-request-card-sending .wallet-tx-request-badge,
  .wallet-tx-request-card-sending .wallet-tx-request-icon-inner {
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
    color: var(--brand);
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
    color: var(--brand);
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
    background: var(--brand);
    color: var(--on-brand);
  }

  .wallet-tx-request-btn-accept:hover:not(:disabled) {
    background: var(--brand-hover);
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
