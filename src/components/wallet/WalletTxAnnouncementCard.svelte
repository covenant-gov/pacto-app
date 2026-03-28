<script lang="ts">
  import type { WalletTxAnnouncementPayload } from '../../lib/wallet/dm-messages';
  import {
    getWalletNetworkDisplayName,
    getExplorerTxUrl,
    explorerTxLinkLabel,
  } from '../../lib/wallet/assets';
  import { copyTextToClipboard } from '../../lib/wallet/clipboard-copy';
  import { showToast } from '../../stores/toast';

  export let payload: WalletTxAnnouncementPayload;
  /** DM counterparty display name (thread peer). */
  export let peerDisplayName: string;
  /** True when the signed-in user posted this announcement (`from_npub`). */
  export let viewerIsSender: boolean;

  $: networkLabel = getWalletNetworkDisplayName(payload.network);
  $: fromAddr = payload.from_evm_address.trim();
  $: fromAddrShort =
    fromAddr.length > 14 ? `${fromAddr.slice(0, 8)}…${fromAddr.slice(-6)}` : fromAddr;
  $: explorerUrl = getExplorerTxUrl(payload.network, payload.tx_hash);
  $: explorerLabel = explorerTxLinkLabel(payload.network);

  async function copyHash() {
    const ok = await copyTextToClipboard(payload.tx_hash);
    showToast(ok ? 'Transaction hash copied' : 'Could not copy hash');
  }
</script>

<div class="wallet-tx-announce-card" role="article">
  <div class="wallet-tx-announce-icon" aria-hidden="true">✓</div>
  <div class="wallet-tx-announce-body">
    <p class="wallet-tx-announce-badge">Transfer confirmed</p>
    <div class="wallet-tx-announce-role">
      <span class="wallet-tx-announce-role-line">
        {viewerIsSender ? 'You transferred' : `${peerDisplayName} transferred`}
      </span>
      <span class="wallet-tx-announce-role-amount">{payload.amount} {payload.asset}</span>
      <span class="wallet-tx-announce-role-line">
        {viewerIsSender ? `to ${peerDisplayName}` : 'to you'}
      </span>
    </div>
    <p class="wallet-tx-announce-subtitle">{networkLabel} · from {fromAddrShort}</p>
    <div class="wallet-tx-announce-hash-row">
      <p class="wallet-tx-announce-hash" title={payload.tx_hash}>
        {payload.tx_hash.slice(0, 10)}…{payload.tx_hash.slice(-8)}
      </p>
      <button
        type="button"
        class="wallet-tx-announce-copy"
        aria-label="Copy full transaction hash"
        on:click={copyHash}
      >
        Copy hash
      </button>
    </div>
    {#if explorerUrl}
      <a
        class="wallet-tx-announce-link"
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={explorerUrl}
      >
        {explorerLabel}
      </a>
    {/if}
  </div>
</div>

<style>
  .wallet-tx-announce-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin: 8px 16px;
    padding: 12px 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    max-width: 380px;
    border-left: 3px solid var(--success);
  }

  .wallet-tx-announce-icon {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: #24804630;
    color: var(--success);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    font-weight: 700;
  }

  .wallet-tx-announce-body {
    flex: 1;
    min-width: 0;
  }

  .wallet-tx-announce-badge {
    margin: 0 0 2px 0;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--success);
  }

  .wallet-tx-announce-role {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 0 6px 0;
  }

  .wallet-tx-announce-role-line {
    font-size: 0.75rem;
    line-height: 1.35;
    color: var(--text-secondary);
  }

  .wallet-tx-announce-role-amount {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .wallet-tx-announce-subtitle {
    margin: 0 0 6px 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .wallet-tx-announce-hash-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 8px 0;
  }

  .wallet-tx-announce-hash {
    margin: 0;
    font-size: 0.75rem;
    font-family: ui-monospace, monospace;
    color: var(--text-secondary);
    word-break: break-all;
    flex: 1;
    min-width: 0;
  }

  .wallet-tx-announce-copy {
    flex-shrink: 0;
    padding: 4px 10px;
    font-size: 0.75rem;
    font-weight: 500;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
  }

  .wallet-tx-announce-copy:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .wallet-tx-announce-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-top: 4px;
    padding: 8px 14px;
    font-size: 0.8125rem;
    font-weight: 600;
    font-family: inherit;
    color: var(--accent-contrast, #fff);
    background: var(--accent);
    border: none;
    border-radius: 8px;
    text-decoration: none;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }

  .wallet-tx-announce-link:hover {
    background: var(--accent-hover);
    filter: brightness(1.02);
  }

  .wallet-tx-announce-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
