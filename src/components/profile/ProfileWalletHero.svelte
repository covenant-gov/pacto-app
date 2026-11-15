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
  import { copyTextToClipboard } from '../../lib/wallet/clipboard-copy';
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
  let accountMenuOpen = $state(false);

  $effect(() => {
    const ids = new Set(squadAccounts.map((a) => a.id));
    if (selectedAccountId && ids.has(selectedAccountId)) return;
    selectedAccountId = defaultAccount?.id ?? '';
  });

  $effect(() => {
    if (!accountMenuOpen) return;
    function onDocPointer(e: PointerEvent) {
      const root = document.getElementById('profile-wallet-account-picker');
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      accountMenuOpen = false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') accountMenuOpen = false;
    }
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  });

  const viewedAccount = $derived(squadAccounts.find((a) => a.id === selectedAccountId) ?? defaultAccount);
  const viewedAddress = $derived(viewedAccount?.address?.trim() || null);
  const viewedAccountName = $derived(accountDisplayName(viewedAccount, viewedAddress));
  const canSwitchAccount = $derived(squadAccounts.length > 1);
  let addressCopied = $state(false);

  function accountDisplayName(acc: EvmAccountRow | null | undefined, address: string | null): string {
    const label = acc?.label?.trim();
    if (label) return label;
    if (address) return shortEvmAddress(address);
    return '';
  }

  function selectAccount(id: string) {
    selectedAccountId = id;
    accountMenuOpen = false;
  }

  async function copyViewedAddress() {
    if (!viewedAddress) return;
    const ok = await copyTextToClipboard(viewedAddress);
    if (!ok) {
      showToast(tFn('wallet.couldNotCopyHash'));
      return;
    }
    addressCopied = true;
    showToast(tFn('wallet.copyAddress'));
    setTimeout(() => (addressCopied = false), 2000);
  }

  let enabledSet = $state(new Set<SupportedChainId>());
  $effect(() => {
    void accountNpub;
    void $walletUiEnabledChainsTick;
    enabledSet = new Set(loadWalletEnabledChains(accountNpub));
  });
  const enabledChainsOrdered = $derived(WALLET_ASSETS_CHAIN_IDS.filter((id) => enabledSet.has(id)));
  const networkDropdownChainIds = $derived(enabledChainsOrdered);
  const watchedRows = $derived(loadWatchedErc20Rows(accountNpub));

  /** `all` = every enabled chain; otherwise one `SupportedChainId`. */
  let networkFilter: 'all' | SupportedChainId = $state('all');

  function networkFilterStorageKey(npub: string): string {
    return `pacto_profile_wallet_network_filter_${npub}`;
  }

  function parseNetworkFilter(raw: string | null): 'all' | SupportedChainId {
    if (!raw || raw === 'all') return 'all';
    if (WALLET_ASSETS_CHAIN_IDS.includes(raw as SupportedChainId)) return raw as SupportedChainId;
    return 'all';
  }

  function loadNetworkFilter(npub: string) {
    if (typeof localStorage === 'undefined') return;
    networkFilter = parseNetworkFilter(localStorage.getItem(networkFilterStorageKey(npub)));
  }

  function saveNetworkFilter() {
    if (typeof localStorage === 'undefined' || !accountNpub) return;
    localStorage.setItem(networkFilterStorageKey(accountNpub), networkFilter);
  }

  $effect(() => {
    if (!accountNpub) {
      networkFilter = 'all';
      return;
    }
    loadNetworkFilter(accountNpub);
  });

  $effect(() => {
    if (networkFilter === 'all' || enabledSet.has(networkFilter)) return;
    networkFilter = 'all';
    saveNetworkFilter();
  });

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

  function networksForBalanceList(
    s: WalletSummary | null,
    filter: 'all' | SupportedChainId,
    enabled: Set<SupportedChainId>,
  ): WalletSummaryNetwork[] {
    if (!s) return [];
    const nets = s.networks.filter((n) => enabled.has(n.network as SupportedChainId));
    return nets.filter((n) => (filter === 'all' ? true : n.network === filter));
  }

  const networksForBalance = $derived(networksForBalanceList(summary, networkFilter, enabledSet));
  const pricing = $derived.by(() => {
    if (!summary) return { status: 'unavailable' as const, total: null as number | null };
    if (networkFilter === 'all') {
      const status = summary.usdPricingStatus ?? 'unavailable';
      let total = status === 'unavailable' ? null : summary.totalUsdApprox;
      if (total == null && status !== 'unavailable') {
        total = sumPricedUsd(networksForBalance);
      }
      return { status, total };
    }
    const status = pricingStatusForNetworks(networksForBalance) ?? 'unavailable';
    const total = status === 'unavailable' ? null : sumPricedUsd(networksForBalance);
    return { status, total };
  });

  function accountLabel(acc: EvmAccountRow): string {
    const name = accountDisplayName(acc, acc.address?.trim() || null);
    const short = shortEvmAddress(acc.address);
    if (!name || name === short) return short;
    return `${name} · ${short}`;
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

  {#if viewedAddress}
    <div id="profile-wallet-account-picker" class="wallet-hero-account">
      <div class="wallet-hero-account-name-row">
        {#if canSwitchAccount}
          <button
            type="button"
            class="wallet-hero-account-name-btn"
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            aria-label={$t('wallet.switchAccountAria')}
            title={$t('wallet.switchAccountAria')}
            onclick={() => (accountMenuOpen = !accountMenuOpen)}
          >
            <span class="wallet-hero-account-name">{viewedAccountName}</span>
            <span class="wallet-hero-account-chevron" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 9L12 15L18 9"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
          </button>
          {#if accountMenuOpen}
            <div class="wallet-hero-account-menu" role="menu">
              {#each squadAccounts as acc (acc.id)}
                <button
                  type="button"
                  class="wallet-hero-account-menu-item"
                  class:wallet-hero-account-menu-item--active={acc.id === selectedAccountId}
                  role="menuitem"
                  onclick={() => selectAccount(acc.id)}
                >
                  {accountLabel(acc)}
                </button>
              {/each}
            </div>
          {/if}
        {:else}
          <span class="wallet-hero-account-name">{viewedAccountName}</span>
        {/if}
      </div>
      <div class="wallet-hero-account-address-pill">
        <code class="wallet-hero-account-address" title={viewedAddress}>{shortEvmAddress(viewedAddress)}</code>
        <button
          type="button"
          class="wallet-hero-account-copy"
          aria-label={$t('wallet.copyAddressToClipboard')}
          title={addressCopied ? $t('wallet.copied') : $t('wallet.copyAddress')}
          onclick={() => void copyViewedAddress()}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      </div>
    </div>
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
  {#if summaryLoading && !summary}
    <p class="wallet-hero-muted">{$t('wallet.loadingBalances')}</p>
  {:else if summary}
    {#if summaryError}
      <p class="wallet-hero-stale" role="status">{$t('wallet.couldNotRefreshBalances')} {summaryError}</p>
    {/if}
    <div class="wallet-hero-filters">
      <label class="wallet-hero-label wallet-hero-label--flush" for="profile-wallet-network-select"
        >{$t('wallet.networkLabel')}</label
      >
      <select
        id="profile-wallet-network-select"
        class="wallet-hero-select"
        bind:value={networkFilter}
        onchange={saveNetworkFilter}
      >
        <option value="all">{$t('wallet.allEnabledNetworks')}</option>
        {#each networkDropdownChainIds as chainId (chainId)}
          <option value={chainId}>{getWalletNetworkDisplayName(chainId)}</option>
        {/each}
      </select>
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

  .wallet-hero-label--flush {
    margin-top: 0;
  }

  .wallet-hero-filters {
    margin-top: 14px;
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

  .wallet-hero-account {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    margin-top: 12px;
    min-width: 0;
  }

  .wallet-hero-account-name-row {
    position: relative;
    min-width: 0;
  }

  .wallet-hero-account-name-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }

  .wallet-hero-account-name-btn:hover .wallet-hero-account-name,
  .wallet-hero-account-name-btn:hover .wallet-hero-account-chevron {
    color: var(--text-primary);
  }

  .wallet-hero-account-name-btn:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
    border-radius: 4px;
  }

  .wallet-hero-account-name {
    min-width: 0;
    font-size: 1.0625rem;
    font-weight: 600;
    line-height: 1.3;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wallet-hero-account-chevron {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .wallet-hero-account-address-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    padding: 6px 10px;
    border-radius: 999px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
  }

  .wallet-hero-account-address {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .wallet-hero-account-copy {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .wallet-hero-account-copy:hover {
    color: var(--text-primary);
  }

  .wallet-hero-account-copy:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
    border-radius: 4px;
  }

  .wallet-hero-account-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 20;
    min-width: 220px;
    max-width: min(360px, 80vw);
    padding: 4px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--text-primary) 12%, transparent);
  }

  .wallet-hero-account-menu-item {
    display: block;
    width: 100%;
    margin: 0;
    padding: 8px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
  }

  .wallet-hero-account-menu-item:hover {
    background: var(--bg-hover);
  }

  .wallet-hero-account-menu-item--active {
    color: var(--brand);
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
