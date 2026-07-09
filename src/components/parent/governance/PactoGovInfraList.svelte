<script lang="ts">
  import { parseSupportedChainId, explorerAddressUrl, SUPPORTED_CHAINS } from '../../../lib/wallet/chains';
  import {
    explorerTxLinkLabel,
    getExplorerTxUrl,
  } from '../../../lib/wallet/assets';
  import { hatsTreeExplorerUrl } from '../../../lib/dashboard/structure-summary';
  import {
    pactoGovDeployAnnounceRows,
    txHashFromPactoGovProviderPayload,
  } from '../../../lib/governance/pacto-gov-payload';

  export let providerPayload: string | null | undefined = undefined;
  export let topHatId = '';
  export let chain: string | undefined = undefined;
  export let showDeployTx = true;

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

  $: chainId = parseSupportedChainId(chain);
  $: chainIdNumeric = SUPPORTED_CHAINS[chainId].id;
  $: explorerLabel = explorerTxLinkLabel(chainId);
  $: rows = pactoGovDeployAnnounceRows({ providerPayload, topHatId });
  $: txHash = showDeployTx ? txHashFromPactoGovProviderPayload(providerPayload) : '';
  $: explorerTxUrl = txHash ? getExplorerTxUrl(chainId, txHash) : null;
</script>

{#if rows.length > 0}
  <ul class="pacto-gov-infra-rows" role="list">
    {#each rows as row (row.kind === 'address' ? row.address : row.hatId)}
      <li class="pacto-gov-infra-row">
        <span class="pacto-gov-infra-label">{row.label}</span>
        {#if row.kind === 'address'}
          <code class="pacto-gov-infra-value" title={row.address}>{shortAddr(row.address)}</code>
          {@const explorerUrl = explorerAddressUrl(chainId, row.address)}
          {#if explorerUrl}
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
            <a
              class="pacto-gov-infra-link"
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {explorerLabel}
            </a>
          {/if}
        {:else}
          <code class="pacto-gov-infra-value" title={row.hatId}>{shortHatId(row.hatId)}</code>
          {@const hatsUrl = hatsTreeExplorerUrl(chainIdNumeric, row.hatId)}
          {#if hatsUrl}
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
            <a
              class="pacto-gov-infra-link"
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
  <p class="pacto-gov-infra-tx">
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
    <a class="pacto-gov-infra-link" href={explorerTxUrl} target="_blank" rel="noopener noreferrer">
      View deployment transaction
    </a>
  </p>
{/if}

<style>
  .pacto-gov-infra-rows {
    list-style: none;
    margin: 0;
    padding: 8px 10px;
    background: var(--bg-elevated);
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .pacto-gov-infra-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 10px;
    font-size: 0.8125rem;
  }

  .pacto-gov-infra-label {
    font-weight: 500;
    color: var(--text-secondary);
    min-width: 8rem;
  }

  .pacto-gov-infra-value {
    font-family: ui-monospace, monospace;
    color: var(--text-primary);
  }

  .pacto-gov-infra-link {
    color: var(--accent);
    text-decoration: none;
  }

  .pacto-gov-infra-link:hover {
    text-decoration: underline;
  }

  .pacto-gov-infra-tx {
    margin: 8px 0 0;
    font-size: 0.8125rem;
  }
</style>
