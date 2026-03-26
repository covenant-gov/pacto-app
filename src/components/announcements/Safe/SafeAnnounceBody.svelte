<script lang="ts">
  import {
    ANNOUNCE_TYPE_SAFE_UPDATED,
    ANNOUNCE_TYPE_SAFE_PROPOSAL,
    type SafeUpdatedPayload,
    type SafeProposalPayload,
  } from '../../../lib/announcements';
  import { getExplorerTxUrl } from '../../../lib/wallet/assets';
  import { parseSupportedChainId, explorerAddressUrl } from '../../../lib/wallet/chains';
  import { copyTextToClipboard } from '../../../lib/wallet/clipboard-copy';
  import { showToast } from '../../../stores/toast';

  /** Safe-related announcement (address updated or proposal). */
  export let announce:
    | { type: typeof ANNOUNCE_TYPE_SAFE_UPDATED; payload: SafeUpdatedPayload }
    | { type: typeof ANNOUNCE_TYPE_SAFE_PROPOSAL; payload: SafeProposalPayload };
  export let authorName: string = '';
  export let timestamp: string = '';

  function formatTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  function shortAddress(addr: string): string {
    if (!addr || addr.length < 12) return addr;
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  $: safePayload = announce.type === ANNOUNCE_TYPE_SAFE_UPDATED ? announce.payload : null;
  $: chainId = safePayload ? parseSupportedChainId(safePayload.chain) : parseSupportedChainId('sepolia');
  $: txHash =
    safePayload?.tx_hash?.trim() && safePayload.tx_hash.trim().length > 0
      ? safePayload.tx_hash.trim()
      : '';
  $: explorerTx =
    safePayload?.explorer_tx_url?.trim() ||
    (txHash ? getExplorerTxUrl(chainId, txHash) : null);
  $: safeExplorerUrl = safePayload ? explorerAddressUrl(chainId, safePayload.safe_address) : '';

  async function copySafeAddress(addr: string) {
    const ok = await copyTextToClipboard(addr);
    showToast(ok ? 'Safe address copied' : 'Could not copy address');
  }

  async function copyTxHash(hash: string) {
    const ok = await copyTextToClipboard(hash);
    showToast(ok ? 'Transaction hash copied' : 'Could not copy hash');
  }
</script>

{#if announce.type === ANNOUNCE_TYPE_SAFE_UPDATED}
  {@const payload = announce.payload}
  <div class="safe-icon" aria-hidden="true">🛡️</div>
  <div class="safe-body">
    <p class="safe-title">{txHash ? 'Safe deployed' : 'Safe address updated'}</p>
    <p class="safe-detail safe-detail-meta">
      {#if payload.chain}<span class="safe-chain">{payload.chain}</span>{/if}
      {#if payload.label}<span class="safe-label">{#if payload.chain} · {/if}{payload.label}</span>{/if}
    </p>
    <div class="safe-hash-row">
      <code class="safe-address mono" title={payload.safe_address}>{shortAddress(payload.safe_address)}</code>
      <button
        type="button"
        class="safe-copy-btn"
        aria-label="Copy full Safe address"
        on:click={() => copySafeAddress(payload.safe_address)}
      >
        Copy address
      </button>
      {#if safeExplorerUrl}
        <a
          class="safe-explorer-link"
          href={safeExplorerUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          View Safe
        </a>
      {/if}
    </div>
    {#if txHash}
      <div class="safe-hash-row safe-hash-row-tx">
        <code class="safe-address mono" title={txHash}>{txHash.slice(0, 10)}…{txHash.slice(-8)}</code>
        <button
          type="button"
          class="safe-copy-btn"
          aria-label="Copy full transaction hash"
          on:click={() => copyTxHash(txHash)}
        >
          Copy tx hash
        </button>
        {#if explorerTx}
          <a class="safe-explorer-link" href={explorerTx} target="_blank" rel="noopener noreferrer">
            View transaction
          </a>
        {/if}
      </div>
      {#if !explorerTx}
        <p class="safe-explorer-fallback muted">Explorer link unavailable for this network.</p>
      {/if}
    {/if}
    {#if authorName || timestamp}
      <p class="safe-meta">
        {#if authorName}{authorName}{/if}
        {#if authorName && timestamp}<span class="safe-meta-sep"> · </span>{/if}
        {#if timestamp}<time datetime={timestamp}>{formatTime(timestamp)}</time>{/if}
      </p>
    {/if}
  </div>
{:else if announce.type === ANNOUNCE_TYPE_SAFE_PROPOSAL}
  {@const payload = announce.payload}
  <div class="safe-icon" aria-hidden="true">📋</div>
  <div class="safe-body">
    <p class="safe-title">Safe proposal</p>
    <p class="safe-detail">
      Send {payload.amount} {payload.token === 'ETH' ? 'ETH' : shortAddress(payload.token)} to <code class="safe-address">{shortAddress(payload.to)}</code>
    </p>
    {#if authorName || timestamp}
      <p class="safe-meta">
        {#if authorName}{authorName}{/if}
        {#if authorName && timestamp}<span class="safe-meta-sep"> · </span>{/if}
        {#if timestamp}<time datetime={timestamp}>{formatTime(timestamp)}</time>{/if}
      </p>
    {/if}
    <div class="safe-actions">
      <button type="button" class="safe-btn" disabled>
        Sign
      </button>
      <button type="button" class="safe-btn safe-btn-secondary" disabled>
        Execute
      </button>
    </div>
  </div>
{/if}

<style>
  .safe-icon {
    font-size: 1.25rem;
    flex-shrink: 0;
  }

  .safe-body {
    flex: 1;
    min-width: 0;
  }

  .safe-title {
    margin: 0 0 4px 0;
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .safe-detail {
    margin: 0 0 4px 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .safe-detail-meta {
    margin-bottom: 8px;
  }

  .safe-chain,
  .safe-label {
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .safe-address {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    background: var(--bg-muted, rgba(0, 0, 0, 0.06));
    padding: 2px 6px;
    border-radius: 4px;
  }

  .safe-address.mono {
    word-break: break-all;
  }

  .safe-hash-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
    margin-bottom: 8px;
  }

  .safe-hash-row-tx {
    margin-top: 4px;
  }

  .safe-copy-btn {
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-secondary);
    font-size: 0.75rem;
    cursor: pointer;
    flex-shrink: 0;
  }

  .safe-copy-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .safe-copy-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .safe-explorer-link {
    font-size: 0.8125rem;
    color: var(--accent);
    text-decoration: none;
    flex-shrink: 0;
  }

  .safe-explorer-link:hover {
    text-decoration: underline;
  }

  .safe-explorer-fallback {
    font-size: 0.75rem;
    margin: 0 0 6px 0;
  }

  .muted {
    color: var(--text-muted);
  }

  .safe-meta {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .safe-meta-sep {
    opacity: 0.8;
  }

  .safe-actions {
    margin-top: 8px;
    display: flex;
    gap: 8px;
  }

  .safe-btn {
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.75rem;
    cursor: not-allowed;
    opacity: 0.6;
  }

  .safe-btn-secondary {
    border-style: dashed;
  }
</style>
