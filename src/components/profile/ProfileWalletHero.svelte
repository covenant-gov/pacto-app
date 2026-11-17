<script lang="ts">
  import { untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import RefreshIconButton from '../ui/RefreshIconButton.svelte';
  import CopyableKeyPill from '../ui/CopyableKeyPill.svelte';
  import WalletHomeSendModal from '../wallet/WalletHomeSendModal.svelte';
  import WalletReceiveModal from '../wallet/WalletReceiveModal.svelte';
  import WalletBalanceList from '../wallet/WalletBalanceList.svelte';
  import WalletImportTokensModal from '../wallet/WalletImportTokensModal.svelte';
  import AccountPicker from '../wallet/AccountPicker.svelte';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { showToast } from '../../stores/toast';
  import {
    getWalletSummary,
    WALLET_ASSETS_CHAIN_IDS,
    watchedRowsToWire,
    type WalletSummary,
  } from '../../lib/wallet';
  import { walletUiEnabledChainsTick } from '../../lib/wallet/wallet-ui-prefs';
  import { walletWatchedTokensTick } from '../../lib/wallet/watched-tokens';
  import { loadWalletViewPrefs } from '../../lib/wallet/wallet-view-prefs';
  import { setActiveEvmAccount, squadEvmAccounts, type EvmAccountRow } from '../../lib/wallet/evm-accounts';
  import {
    PROFILE_NETWORK_FILTER_PREFIX,
    coerceNetworkFilter,
    loadNetworkFilter,
    saveNetworkFilter,
    type NetworkFilter,
  } from '../../lib/wallet/network-filter';
  import {
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
  const primaryAccount = $derived(
    squadAccounts.find((a) => a.isActive) ?? squadAccounts[0] ?? null,
  );

  let selectedAccountId = $state('');

  $effect(() => {
    const id = primaryAccount?.id ?? '';
    if (id) selectedAccountId = id;
  });

  const viewedAccount = $derived(squadAccounts.find((a) => a.id === selectedAccountId) ?? primaryAccount);
  const viewedAddress = $derived(viewedAccount?.address?.trim() || null);

  async function selectAccount(id: string) {
    if (!id || id === selectedAccountId) return;
    try {
      await setActiveEvmAccount(id);
      showToast(get(t)('wallet.primaryAccountSaved'));
    } catch (e) {
      showToast(getInvokeErrorMessage(e, get(t)('wallet.couldNotSetPrimaryAccount')));
    }
  }

  const prefs = $derived.by(() => {
    void $walletUiEnabledChainsTick;
    void $walletWatchedTokensTick;
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
  let addTokensOpen = $state(false);

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

  {#if summaryLoading && !summary}
    <p class="wallet-hero-muted">{$t('wallet.loadingBalances')}</p>
  {:else if summary && summaryAddress === viewedAddress}
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
    <WalletBalanceList
      enabledChainIds={enabledChainsOrdered}
      {networkFilter}
      networks={networksForBalance}
      onNetworkFilter={(next) => {
        networkFilter = next;
        saveNetworkFilter(PROFILE_NETWORK_FILTER_PREFIX, next);
      }}
      onAddTokens={() => (addTokensOpen = true)}
    />
  {:else if summaryError}
    <p class="wallet-hero-stale" role="alert">{summaryError}</p>
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

<WalletImportTokensModal
  open={addTokensOpen}
  accountNpub={accountNpub}
  ownerAddress={viewedAddress}
  enabledChainIds={enabledChainsOrdered}
  onClose={() => (addTokensOpen = false)}
  onSaved={() => {}}
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

</style>
