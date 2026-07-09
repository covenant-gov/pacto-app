<script lang="ts">
  import type { GovernanceUpdatedPayload } from '../../lib/announcements';
  import { parseSupportedChainId, explorerAddressUrl } from '../../lib/wallet/chains';
  import {
    explorerTxLinkLabel,
    getExplorerTxUrl,
    getWalletNetworkDisplayName,
  } from '../../lib/wallet/assets';
  import { formatMessageTimestamp } from '../../lib/utils/message-formatting';
  import { profiles } from '../../stores/profiles';
  import { getProfileDisplayName } from '../../lib/utils/profile';

  export let payload: GovernanceUpdatedPayload;
  export let authorName: string;
  export let authorNpub: string | undefined = undefined;
  export let timestamp: string;

  function shortAddr(addr: string): string {
    const a = addr.trim();
    if (a.length < 18) return a;
    return `${a.slice(0, 10)}…${a.slice(-8)}`;
  }

  function txHashFromProviderPayload(raw: string | undefined): string {
    if (!raw?.trim()) return '';
    try {
      const parsed = JSON.parse(raw) as { txHash?: unknown; tx_hash?: unknown };
      const h = parsed.txHash ?? parsed.tx_hash;
      return typeof h === 'string' ? h.trim() : '';
    } catch {
      return '';
    }
  }

  function governanceSummary(provider: string, name: string): string {
    const who = name.trim() || 'A member';
    switch (provider.trim().toLowerCase()) {
      case 'sponsor':
        return `${who} deployed the squad sponsor`;
      case 'pacto_gov':
        return `${who} deployed Pacto Gov`;
      case 'squad_admin':
        return `${who} deployed Squad Admin`;
      case 'gnosis_safe':
        return `${who} linked a treasury Safe`;
      default:
        return `${who} updated squad infrastructure`;
    }
  }

  $: displayName =
    (authorNpub ? getProfileDisplayName($profiles[authorNpub]) : '') || authorName || 'A member';
  $: chainId = parseSupportedChainId(payload.chain);
  $: networkLabel = getWalletNetworkDisplayName(chainId);
  $: contractAddr = payload.canonical_ref?.trim() ?? '';
  $: explorerUrl = contractAddr ? explorerAddressUrl(chainId, contractAddr) : '';
  $: explorerLabel = explorerTxLinkLabel(chainId);
  $: summary = governanceSummary(payload.provider, displayName);
  $: txHash = txHashFromProviderPayload(payload.provider_payload);
  $: explorerTxUrl = txHash ? getExplorerTxUrl(chainId, txHash) : null;
</script>

<div class="gov-updated-body">
  <p class="gov-updated-title">{summary}</p>
  {#if networkLabel}
    <p class="gov-updated-network">{networkLabel}</p>
  {/if}
  {#if contractAddr}
    <div class="gov-updated-addr-box">
      <code class="gov-updated-addr" title={contractAddr}>{shortAddr(contractAddr)}</code>
      {#if explorerUrl}
        <a
          class="gov-updated-explorer-link"
          href={explorerUrl}
          target="_blank"
          rel="external noopener noreferrer"
        >
          {explorerLabel}
        </a>
      {/if}
    </div>
  {/if}
  {#if explorerTxUrl}
    <p class="gov-updated-tx">
      <a class="gov-updated-explorer-link" href={explorerTxUrl} target="_blank" rel="external noopener noreferrer">
        View deployment transaction
      </a>
    </p>
  {/if}
  {#if timestamp}
    <p class="gov-updated-meta">{formatMessageTimestamp(timestamp)}</p>
  {/if}
</div>

<style>
  .gov-updated-body {
    flex: 1;
    min-width: 0;
  }

  .gov-updated-title {
    margin: 0;
    font-weight: 600;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--text-primary);
  }

  .gov-updated-network {
    margin: 4px 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .gov-updated-addr-box {
    margin-top: 10px;
    padding: 8px 10px;
    background: var(--bg-elevated);
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
  }

  .gov-updated-addr {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    color: var(--text-primary);
  }

  .gov-updated-explorer-link {
    font-size: 0.8125rem;
    color: var(--accent);
    text-decoration: none;
  }

  .gov-updated-explorer-link:hover {
    text-decoration: underline;
  }

  .gov-updated-tx {
    margin: 8px 0 0;
    font-size: 0.8125rem;
  }

  .gov-updated-meta {
    margin: 10px 0 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
