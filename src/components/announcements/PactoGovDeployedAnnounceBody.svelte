<script lang="ts">
  import type { GovernanceUpdatedPayload } from '../../lib/announcements';
  import { parseSupportedChainId, explorerAddressUrl, SUPPORTED_CHAINS } from '../../lib/wallet/chains';
  import {
    explorerTxLinkLabel,
    getExplorerTxUrl,
    getWalletNetworkDisplayName,
  } from '../../lib/wallet/assets';
  import { hatsTreeExplorerUrl } from '../../lib/dashboard/structure-summary';
  import {
    pactoGovDeployAnnounceRows,
    txHashFromPactoGovProviderPayload,
  } from '../../lib/governance/pacto-gov-payload';
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

  function shortHatId(id: string): string {
    const t = id.trim();
    if (t.length <= 16) return t;
    return `${t.slice(0, 8)}…${t.slice(-6)}`;
  }

  $: displayName =
    (authorNpub ? getProfileDisplayName($profiles[authorNpub]) : '') || authorName || 'A member';
  $: chainId = parseSupportedChainId(payload.chain);
  $: chainIdNumeric = SUPPORTED_CHAINS[chainId].id;
  $: networkLabel = getWalletNetworkDisplayName(chainId);
  $: explorerLabel = explorerTxLinkLabel(chainId);
  $: rows = pactoGovDeployAnnounceRows({
    providerPayload: payload.provider_payload,
    topHatId: payload.canonical_ref ?? '',
  });
  $: txHash = txHashFromPactoGovProviderPayload(payload.provider_payload);
  $: explorerTxUrl = txHash ? getExplorerTxUrl(chainId, txHash) : null;
</script>

<div class="pacto-gov-deploy-body">
  <p class="pacto-gov-deploy-title">{displayName} deployed Pacto Gov</p>
  {#if networkLabel}
    <p class="pacto-gov-deploy-network">{networkLabel}</p>
  {/if}
  {#if rows.length > 0}
    <ul class="pacto-gov-deploy-rows" role="list">
      {#each rows as row (row.kind === 'address' ? row.address : row.hatId)}
        <li class="pacto-gov-deploy-row">
          <span class="pacto-gov-deploy-label">{row.label}</span>
          {#if row.kind === 'address'}
            <code class="pacto-gov-deploy-value" title={row.address}>{shortAddr(row.address)}</code>
            {@const explorerUrl = explorerAddressUrl(chainId, row.address)}
            {#if explorerUrl}
              <a
                class="pacto-gov-deploy-link"
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {explorerLabel}
              </a>
            {/if}
          {:else}
            <code class="pacto-gov-deploy-value" title={row.hatId}>{shortHatId(row.hatId)}</code>
            {@const hatsUrl = hatsTreeExplorerUrl(chainIdNumeric, row.hatId)}
            {#if hatsUrl}
              <a
                class="pacto-gov-deploy-link"
                href={hatsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Hats tree
              </a>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if explorerTxUrl}
    <p class="pacto-gov-deploy-tx">
      <a class="pacto-gov-deploy-link" href={explorerTxUrl} target="_blank" rel="noopener noreferrer">
        View deployment transaction
      </a>
    </p>
  {/if}
  {#if timestamp}
    <p class="pacto-gov-deploy-meta">{formatMessageTimestamp(timestamp)}</p>
  {/if}
</div>

<style>
  .pacto-gov-deploy-body {
    flex: 1;
    min-width: 0;
  }

  .pacto-gov-deploy-title {
    margin: 0;
    font-weight: 600;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--text-primary);
  }

  .pacto-gov-deploy-network {
    margin: 4px 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .pacto-gov-deploy-rows {
    list-style: none;
    margin: 10px 0 0;
    padding: 8px 10px;
    background: var(--bg-elevated);
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .pacto-gov-deploy-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 10px;
    font-size: 0.8125rem;
  }

  .pacto-gov-deploy-label {
    font-weight: 500;
    color: var(--text-secondary);
    min-width: 8rem;
  }

  .pacto-gov-deploy-value {
    font-family: ui-monospace, monospace;
    color: var(--text-primary);
  }

  .pacto-gov-deploy-link {
    color: var(--accent);
    text-decoration: none;
  }

  .pacto-gov-deploy-link:hover {
    text-decoration: underline;
  }

  .pacto-gov-deploy-tx {
    margin: 8px 0 0;
    font-size: 0.8125rem;
  }

  .pacto-gov-deploy-meta {
    margin: 10px 0 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
