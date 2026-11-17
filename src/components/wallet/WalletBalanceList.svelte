<script lang="ts">
  import { t } from 'svelte-i18n';
  import { formatAssetAmount } from '../../lib/evm/format-token-amount';
  import { getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import type { SupportedChainId } from '../../lib/wallet/chains';
  import type { NetworkFilter } from '../../lib/wallet/network-filter';
  import { networkErrorMessage } from '../../lib/wallet/wallet-summary-view';
  import type { WalletSummaryAsset, WalletSummaryNetwork } from '../../lib/wallet/backend-wallet';

  interface Props {
    enabledChainIds: SupportedChainId[];
    networkFilter: NetworkFilter;
    networks: WalletSummaryNetwork[];
    onNetworkFilter: (next: NetworkFilter) => void;
    onAddTokens: () => void;
  }

  let {
    enabledChainIds,
    networkFilter,
    networks,
    onNetworkFilter,
    onAddTokens,
  }: Props = $props();

  const showChainHeadings = $derived(enabledChainIds.length > 1 && networkFilter === 'all');
</script>

<div class="wallet-balance-tools">
  {#if enabledChainIds.length > 1}
    <select
      class="wallet-balance-networks"
      aria-label={$t('wallet.networksMenu')}
      value={networkFilter}
      onchange={(e) => onNetworkFilter(e.currentTarget.value as NetworkFilter)}
    >
      <option value="all">{$t('wallet.allEnabledNetworks')}</option>
      {#each enabledChainIds as chainId (chainId)}
        <option value={chainId}>{getWalletNetworkDisplayName(chainId)}</option>
      {/each}
    </select>
  {/if}
  <button type="button" class="wallet-balance-add" onclick={onAddTokens}>
    {$t('wallet.addTokens')}
  </button>
</div>

{#if networks.length === 0}
  <p class="wallet-balance-muted">{$t('wallet.noNetworksMatchFilter')}</p>
{:else}
  <ul class="wallet-balance-nets">
    {#each networks as net (net.network)}
      <li class="wallet-balance-net">
        {#if showChainHeadings}
          <span class="wallet-balance-net-name">{getWalletNetworkDisplayName(net.network as SupportedChainId)}</span>
        {/if}
        {#if net.error}
          <p class="wallet-balance-net-error" title={net.error}>{networkErrorMessage(net)}</p>
        {:else}
          <ul class="wallet-balance-assets">
            {#each net.assets as asset, i (`${net.network}-${asset.symbol}-${i}`)}
              {@const row = asset as WalletSummaryAsset}
              <li>
                <span>{row.symbol}</span>
                <span>{formatAssetAmount(row.balanceRaw, { symbol: row.symbol, decimals: row.decimals }) ?? '—'}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .wallet-balance-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }

  .wallet-balance-networks,
  .wallet-balance-add {
    box-sizing: border-box;
    height: 32px;
    padding: 0 10px;
    font-size: 0.8125rem;
    line-height: 1.25;
    border-radius: 6px;
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: inherit;
  }

  .wallet-balance-networks {
    max-width: 220px;
    padding-right: 28px;
    background: var(--bg-elevated);
  }

  .wallet-balance-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 500;
    background: transparent;
    cursor: pointer;
  }

  .wallet-balance-muted {
    margin: 10px 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .wallet-balance-nets,
  .wallet-balance-assets {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
  }

  .wallet-balance-net {
    padding: 8px 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .wallet-balance-net-name {
    display: block;
    margin-bottom: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .wallet-balance-net-error {
    margin: 4px 0 0;
    font-size: 0.8125rem;
    color: var(--danger);
  }

  .wallet-balance-assets li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }
</style>
