<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from 'svelte-i18n';
  import RefreshIconButton from '../ui/RefreshIconButton.svelte';
  import CopyableKeyPill from '../ui/CopyableKeyPill.svelte';
  import WalletHomeSendModal from '../wallet/WalletHomeSendModal.svelte';
  import WalletReceiveModal from '../wallet/WalletReceiveModal.svelte';
  import AccountPicker from './AccountPicker.svelte';
  import { formatAssetAmount } from '../../lib/evm/format-token-amount';
  import {
    getWalletSummary,
    getWalletNetworkDisplayName,
    WALLET_ASSETS_CHAIN_IDS,
    watchedRowsToWire,
    type WalletSummary,
    type WalletSummaryAsset,
    type SupportedChainId,
  } from '../../lib/wallet';
  import { walletUiEnabledChainsTick } from '../../lib/wallet/wallet-ui-prefs';
  import { loadWalletViewPrefs } from '../../lib/wallet/wallet-view-prefs';
  import { squadEvmAccounts, type EvmAccountRow } from '../../lib/wallet/evm-accounts';
  import {
    PROFILE_NETWORK_FILTER_PREFIX,
    coerceNetworkFilter,
    loadNetworkFilter,
    saveNetworkFilter,
    type NetworkFilter,
  } from '../../lib/wallet/network-filter';
  import {
    networkErrorMessage,
    networksForBalanceList,
    summaryPricing,
    walletSummaryFetchKey,
  } from '../../lib/wallet/wallet-summary-view';

  interface Props {
    accountNpub: string;
    evmAccountList?: EvmAccountRow[];
  }

  let { accountNpub, evmAccountList = [] }: Props = $props();

  const squadAccounts = $derived(squadEvmAccounts(evmAccountList));
  const defaultAccount = $derived(
    squadAccounts.find((a) => a.isDefaultShared) ?? squadAccounts.find((a) => a.isActive) ?? squadAccounts[0] ?? null,
  );

  let selectedAccountId = $state('');

  $effect(() => {
    const ids = new Set(squadAccounts.map((a) => a.id));
    if (selectedAccountId && ids.has(selectedAccountId)) return;
    selectedAccountId = defaultAccount?.id ?? '';
  });

  const viewedAccount = $derived(squadAccounts.find((a) => a.id === selectedAccountId) ?? defaultAccount);
  const viewedAddress = $derived(viewedAccount?.address?.trim() || null);

  function selectAccount(id: string) {
    selectedAccountId = id;
  }

  const prefs = $derived.by(() => {
    void $walletUiEnabledChainsTick;
    return loadWalletViewPrefs(accountNpub);
  });
  const enabledSet = $derived(prefs.enabledSet);
  const watchedRows = $derived(prefs.watchedRows);
  const enabledChainsOrdered = $derived(WALLET_ASSETS_CHAIN_IDS.filter((id) => enabledSet.has(id)));

  let networkFilter: NetworkFilter = $state('all');

  $effect(() => {
    void accountNpub;
    networkFilter = loadNetworkFilter(PROFILE_NETWORK_FILTER_PREFIX);
  });

  $effect(() => {
    const next = coerceNetworkFilter(networkFilter, enabledSet);
    if (next === networkFilter) return;
    networkFilter = next;
    saveNetworkFilter(PROFILE_NETWORK_FILTER_PREFIX, next);
  });

  let summary = $state<WalletSummary | null>(null);
  let summaryAddress = $state<string | null>(null);
  let summaryError = $state<string | null>(null);
  let summaryLoading = $state(false);
  let loadSeq = 0;
  let homeSendOpen = $state(false);
  let receiveOpen = $state(false);

  async function refreshSummary() {
    const seq = ++loadSeq;
    const address = viewedAddress;
    if (!address) {
      summary = null;
      summaryAddress = null;
      summaryError = null;
      summaryLoading = false;
      return;
    }
    if (summaryAddress !== address) {
      summary = null;
      summaryError = null;
    }
    summaryLoading = true;
    const r = await getWalletSummary(watchedRowsToWire(watchedRows), enabledChainsOrdered, address);
    if (seq !== loadSeq) return;
    if (r.ok) {
      summary = r.summary;
      summaryAddress = address;
      summaryError = null;
    } else {
      summaryError = r.message;
      if (summaryAddress !== address) {
        summary = null;
        summaryAddress = null;
      }
    }
    summaryLoading = false;
  }

  const summaryKey = $derived(
    walletSummaryFetchKey(viewedAddress, enabledChainsOrdered, watchedRowsToWire(watchedRows)),
  );

  $effect(() => {
    void summaryKey;
    untrack(() => void refreshSummary());
  });

  const networksForBalance = $derived(networksForBalanceList(summary, networkFilter, enabledSet));
  const pricing = $derived(summaryPricing(summary, networkFilter, networksForBalance));

  function openSend() {
    if (!viewedAccount || !viewedAddress) return;
    homeSendOpen = true;
  }
</script>

<section class="wallet-hero" aria-labelledby="profile-wallet-heading">
  <div class="wallet-hero-head">
    <h2 id="profile-wallet-heading" class="wallet-hero-title">{$t('wallet.walletTitle')}</h2>
    <RefreshIconButton
      disabled={summaryLoading}
      spinning={summaryLoading}
      ariaLabel={summaryLoading ? $t('wallet.refreshingBalances') : $t('wallet.refreshBalances')}
      onclick={() => void refreshSummary()}
    />
  </div>

  {#if viewedAddress}
    <div class="wallet-hero-account">
      <AccountPicker accounts={squadAccounts} selectedId={selectedAccountId} onSelect={selectAccount} />
      <CopyableKeyPill value={viewedAddress} ariaLabel={$t('wallet.copyAddressToClipboard')} />
    </div>
  {/if}

  <div class="wallet-hero-actions">
    <button type="button" class="wallet-hero-btn" disabled={!viewedAddress} onclick={openSend}>
      {$t('wallet.send')}
    </button>
    <button
      type="button"
      class="wallet-hero-btn wallet-hero-btn-secondary"
      disabled={!viewedAddress}
      onclick={() => (receiveOpen = true)}
    >
      {$t('wallet.receive')}
    </button>
  </div>
  {#if summaryLoading && !summary}
    <p class="wallet-hero-muted">{$t('wallet.loadingBalances')}</p>
  {:else if summary && summaryAddress === viewedAddress}
    {#if summaryError}
      <p class="wallet-hero-stale" role="status">{$t('wallet.couldNotRefreshBalances')} {summaryError}</p>
    {/if}
    <div class="wallet-hero-filters ui-field-row">
      <div class="ui-field">
        <label class="ui-field-label" for="profile-wallet-network-select">{$t('wallet.networkLabel')}</label>
        <select
          id="profile-wallet-network-select"
          class="ui-select"
          bind:value={networkFilter}
          onchange={() => saveNetworkFilter(PROFILE_NETWORK_FILTER_PREFIX, networkFilter)}
        >
          <option value="all">{$t('wallet.allEnabledNetworks')}</option>
          {#each enabledChainsOrdered as chainId (chainId)}
            <option value={chainId}>{getWalletNetworkDisplayName(chainId)}</option>
          {/each}
        </select>
      </div>
    </div>
    <p class="wallet-hero-total">
      {#if pricing.status === 'unavailable' || pricing.total == null}
        {$t('wallet.totalUsdUnavailable')}
      {:else}
        {#if pricing.status === 'partial'}
          {$t('wallet.totalUsdPartial')}
        {:else}
          {$t('wallet.totalApprox')}
        {/if}
        <strong>${pricing.total.toFixed(2)}</strong>
      {/if}
    </p>
    {#if networksForBalance.length === 0}
      <p class="wallet-hero-muted">{$t('wallet.noNetworksMatchFilter')}</p>
    {:else}
      <ul class="wallet-hero-nets">
        {#each networksForBalance as net (net.network)}
          <li class="wallet-hero-net">
            {#if networkFilter === 'all'}
              <span class="wallet-hero-net-name">{getWalletNetworkDisplayName(net.network as SupportedChainId)}</span>
            {/if}
            {#if net.error}
              <p class="wallet-hero-net-error" title={net.error}>{networkErrorMessage(net)}</p>
            {:else}
              <ul class="wallet-hero-assets">
                {#each net.assets as asset, i (`${net.network}-${asset.symbol}-${i}`)}
                  {@const a = asset as WalletSummaryAsset}
                  <li>
                    <span>{a.symbol}</span>
                    <span>{formatAssetAmount(a.balanceRaw, { symbol: a.symbol, decimals: a.decimals }) ?? '—'}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {:else if summaryError}
    <p class="wallet-hero-stale" role="alert">{summaryError}</p>
  {/if}
</section>

<WalletHomeSendModal
  open={homeSendOpen}
  onClose={() => (homeSendOpen = false)}
  watchedAssetRows={watchedRows}
  enabledChainIds={enabledChainsOrdered}
  fromAccount={viewedAccount && viewedAddress ? { id: viewedAccount.id, address: viewedAddress } : null}
/>

<WalletReceiveModal
  open={receiveOpen && !!viewedAddress}
  address={viewedAddress ?? ''}
  onClose={() => (receiveOpen = false)}
/>

<style>
  .wallet-hero {
    min-width: 0;
  }

  .wallet-hero-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .wallet-hero-title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .wallet-hero-filters {
    margin-top: 14px;
    max-width: 320px;
  }

  .wallet-hero-account {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    margin-top: 12px;
    min-width: 0;
  }

  .wallet-hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 16px;
  }

  .wallet-hero-btn {
    min-width: 108px;
    min-height: 40px;
    padding: 0 16px;
    border: none;
    border-radius: 8px;
    background: var(--brand);
    color: var(--on-brand);
    font-size: 0.875rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  .wallet-hero-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .wallet-hero-btn-secondary {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .wallet-hero-muted {
    margin: 10px 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .wallet-hero-stale {
    margin: 10px 0 0;
    font-size: 0.8125rem;
    color: var(--danger);
  }

  .wallet-hero-total {
    margin: 14px 0 0;
    font-size: 0.9375rem;
    color: var(--text-secondary);
  }

  .wallet-hero-nets,
  .wallet-hero-assets {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
  }

  .wallet-hero-net {
    padding: 8px 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .wallet-hero-net-name {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .wallet-hero-net-error {
    margin: 4px 0 0;
    font-size: 0.8125rem;
    color: var(--danger);
  }

  .wallet-hero-assets li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }
</style>
