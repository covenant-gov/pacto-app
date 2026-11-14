<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import RefreshIconButton from '../ui/RefreshIconButton.svelte';
  import WalletHomeSendModal from '../wallet/WalletHomeSendModal.svelte';
  import WalletReceiveModal from '../wallet/WalletReceiveModal.svelte';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { showToast } from '../../stores/toast';
  import { formatAssetAmount } from '../../lib/evm/format-token-amount';
  import {
    getWalletSummary,
    getWalletNetworkDisplayName,
    WALLET_ASSETS_CHAIN_IDS,
    watchedRowsToWire,
    loadWatchedErc20Rows,
    type WalletSummary,
    type WalletSummaryNetwork,
    type WalletSummaryAsset,
    type SupportedChainId,
    sumPricedUsd,
    pricingStatusForNetworks,
  } from '../../lib/wallet';
  import { loadWalletEnabledChains, walletUiEnabledChainsTick } from '../../lib/wallet/wallet-ui-prefs';
  import {
    setActiveEvmAccount,
    squadEvmAccounts,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import { shortEvmAddress } from '../../lib/governance/hats-tree-annotations';

  const tFn = get(t);

  interface Props {
    accountNpub: string;
    evmAccountList?: EvmAccountRow[];
    onAccountsChanged?: () => void | Promise<void>;
  }

  let { accountNpub, evmAccountList = [], onAccountsChanged = () => {} }: Props = $props();

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

  let enabledSet = $state(new Set<SupportedChainId>());
  $effect(() => {
    void accountNpub;
    void $walletUiEnabledChainsTick;
    enabledSet = new Set(loadWalletEnabledChains(accountNpub));
  });
  const enabledChainsOrdered = $derived(WALLET_ASSETS_CHAIN_IDS.filter((id) => enabledSet.has(id)));
  const watchedRows = $derived(loadWatchedErc20Rows(accountNpub));

  let summary = $state<WalletSummary | null>(null);
  let summaryError = $state<string | null>(null);
  let summaryLoading = $state(false);
  let loadSeq = 0;
  let homeSendOpen = $state(false);
  let receiveOpen = $state(false);
  let sendBusy = $state(false);

  async function refreshSummary() {
    const seq = ++loadSeq;
    const address = viewedAddress;
    if (!address) {
      summary = null;
      summaryError = null;
      summaryLoading = false;
      return;
    }
    summaryLoading = true;
    const wire = watchedRowsToWire(watchedRows);
    const r = await getWalletSummary(wire, enabledChainsOrdered, address);
    if (seq !== loadSeq) return;
    if (r.ok) {
      summary = r.summary;
      summaryError = null;
    } else {
      summaryError = r.message;
      if (!summary) summary = null;
    }
    summaryLoading = false;
  }

  $effect(() => {
    void viewedAddress;
    void enabledChainsOrdered.join(',');
    void watchedRows.length;
    void refreshSummary();
  });

  const networksForBalance = $derived(
    (summary?.networks ?? []).filter((n) => enabledSet.has(n.network as SupportedChainId)),
  );
  const pricing = $derived.by(() => {
    if (!summary) return { status: 'unavailable' as const, total: null as number | null };
    const status = pricingStatusForNetworks(networksForBalance) ?? summary.usdPricingStatus;
    const total = status === 'unavailable' ? null : (sumPricedUsd(networksForBalance) ?? summary.totalUsdApprox);
    return { status, total };
  });

  function accountLabel(acc: EvmAccountRow): string {
    const parts = [shortEvmAddress(acc.address)];
    if (acc.label?.trim()) parts.push(acc.label.trim());
    if (acc.isDefaultShared) parts.push(tFn('wallet.receiverBadge'));
    else if (acc.isActive) parts.push(tFn('wallet.signerBadge'));
    return parts.join(' · ');
  }

  function networkErrorMessage(net: WalletSummaryNetwork): string {
    if (net.network === 'local') return tFn('wallet.anvilNotDetected');
    return tFn('wallet.couldNotReachNetwork', {
      values: { network: getWalletNetworkDisplayName(net.network as SupportedChainId) },
    });
  }

  async function openSend() {
    if (!viewedAccount || sendBusy) return;
    sendBusy = true;
    try {
      if (!viewedAccount.isActive) {
        await setActiveEvmAccount(viewedAccount.id);
        await onAccountsChanged();
      }
      homeSendOpen = true;
    } catch (e) {
      showToast(getInvokeErrorMessage(e, tFn('wallet.couldNotSwitchBeforeSend')));
    } finally {
      sendBusy = false;
    }
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

  {#if squadAccounts.length > 0}
    <label class="wallet-hero-label" for="profile-wallet-account">{$t('wallet.selectAccount')}</label>
    <select id="profile-wallet-account" class="wallet-hero-select" bind:value={selectedAccountId}>
      {#each squadAccounts as acc (acc.id)}
        <option value={acc.id}>{accountLabel(acc)}</option>
      {/each}
    </select>
  {/if}

  {#if viewedAddress}
    <p class="wallet-hero-address">
      <span>{$t('wallet.viewingAccount')}</span>
      <code>{viewedAddress}</code>
    </p>
  {/if}

  <div class="wallet-hero-actions">
    <button type="button" class="wallet-hero-btn" disabled={!viewedAddress || sendBusy} onclick={() => void openSend()}>
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
  <p class="wallet-hero-hint">{$t('wallet.receiveDesc')}</p>

  {#if summaryLoading && !summary}
    <p class="wallet-hero-muted">{$t('wallet.loadingBalances')}</p>
  {:else if summary}
    {#if summaryError}
      <p class="wallet-hero-stale" role="status">{$t('wallet.couldNotRefreshBalances')} {summaryError}</p>
    {/if}
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
            <span class="wallet-hero-net-name">{getWalletNetworkDisplayName(net.network as SupportedChainId)}</span>
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

  .wallet-hero-label {
    display: block;
    margin: 14px 0 6px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .wallet-hero-select {
    width: 100%;
    max-width: 420px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font: inherit;
  }

  .wallet-hero-address {
    margin: 10px 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .wallet-hero-address code {
    display: block;
    margin-top: 4px;
    word-break: break-all;
    color: var(--text-secondary);
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

  .wallet-hero-hint,
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
