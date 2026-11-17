<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { getDmPeerEvmAddress } from '../../lib/api/wallet-peers';
  import { getEvmAddress } from '../../lib/api/auth';
  import { getActiveEvmSignerAddress } from '../../lib/wallet/evm-accounts';
  import {
    isWalletPeerInfoRequestInFlight,
    sendWalletPeerInfoRequest,
    walletPeerInfoRequestInFlightRevision,
  } from '../../lib/wallet/wallet-peer-exchange';
  import { profiles } from '../../stores/profiles';
  import { currentUser } from '../../stores/auth-session';
  import { resolveShownName } from '../../lib/username/shown-name';
  import { peerUsernameClaims, ensureShownName } from '../../stores/peer-username';
  import { usernameState } from '../../stores/username';
  import {
    getWalletSummary,
    WALLET_ASSETS_CHAIN_IDS,
    watchedRowsToWire,
    loadWatchedErc20Rows,
    type WalletSummary,
    type WatchedErc20Row,
    getMatchingCachedSummary,
    persistWalletSummaryCache,
  } from '../../lib/wallet';
  import { loadWalletEnabledChains, walletUiEnabledChainsTick } from '../../lib/wallet/wallet-ui-prefs';
  import { walletWatchedTokensTick } from '../../lib/wallet/watched-tokens';
  import {
    WALLET_BAR_NETWORK_FILTER_PREFIX,
    coerceNetworkFilter,
    loadNetworkFilter,
    saveNetworkFilter,
    type NetworkFilter,
  } from '../../lib/wallet/network-filter';
  import { networksForBalanceList, summaryPricing } from '../../lib/wallet/wallet-summary-view';
  import WalletBalanceList from './WalletBalanceList.svelte';
  import { showToast } from '../../stores/toast';
  import {
    walletSendPrefillFromRequest,
    dmWalletPeerExchangeTick,
    type WalletSendPrefillPayload,
  } from '../../stores/app';
  import WalletSendModal from './WalletSendModal.svelte';
  import WalletRequestModal from './WalletRequestModal.svelte';
  import WalletImportTokensModal from './WalletImportTokensModal.svelte';
  import RefreshIconButton from '../ui/RefreshIconButton.svelte';

  const tFn = get(t);

  interface Props {
    /** Active DM counterparty npub */
    npub: string;
    /** Send structured DM text to the active thread (same path as the composer). */
    postDmPlaintext?: ((content: string) => Promise<boolean>) | undefined;
  }

  let { npub, postDmPlaintext = undefined }: Props = $props();

  let sendModalOpen = $state(false);
  let requestModalOpen = $state(false);
  let importTokensModalOpen = $state(false);
  /** Form prefill when opening Send from Accept on a payment request card. */
  let sendModalPrefill: WalletSendPrefillPayload | null = $state(null);

  const contactProfile = $derived(npub ? $profiles[npub] : null);
  const contactDisplayName = $derived(
    npub
      ? resolveShownName({
          npub,
          profile: contactProfile,
          chain: {
            selfNpub: $currentUser?.npub,
            usernameState: $usernameState,
            peerClaims: $peerUsernameClaims,
          },
        }).name
      : tFn('wallet.anonymous'),
  );

  $effect(() => {
    if (npub) ensureShownName(npub);
  });

  let summaryLoading = $state(true);
  let summaryError: string | null = $state(null);
  let summary: WalletSummary | null = $state(null);

  let networkFilter: NetworkFilter = $state('all');

  /** Logged-in account: watched ERC-20 list is keyed by this npub. */
  const accountNpub = $derived($currentUser?.npub ?? null);

  let watchedErc20Rows: WatchedErc20Row[] = $state([]);

  let peerWalletReady = $state(false);
  let ownerAddress = $state<string | null>(null);

  const peerInfoRequestInFlight = $derived.by(() => {
    void $walletPeerInfoRequestInFlightRevision;
    return npub ? isWalletPeerInfoRequestInFlight(npub) : false;
  });

  /** Unlock Send/Request only after pairwise `dm_peer_evm` exchange. */
  async function syncPeerWalletReady() {
    const peerNpub = npub;
    if (!peerNpub) {
      peerWalletReady = false;
      return;
    }
    try {
      const fromDm = await getDmPeerEvmAddress(peerNpub);
      if (npub !== peerNpub) return;
      peerWalletReady = Boolean(fromDm?.trim());
    } catch {
      if (npub !== peerNpub) return;
      peerWalletReady = false;
    }
  }

  $effect(() => {
    void npub;
    void $dmWalletPeerExchangeTick;
    void syncPeerWalletReady();
  });

  async function sendWalletInfoRequest() {
    const me = get(currentUser)?.npub;
    const peerNpub = npub;
    if (!me || !peerNpub || peerInfoRequestInFlight) return;
    if (peerWalletReady) {
      showToast(tFn('wallet.alreadyHavePayoutAddress'));
      return;
    }
    const post = postDmPlaintext;
    if (!post) {
      showToast(tFn('wallet.useDesktopAppForRequest'));
      return;
    }
    const result = await sendWalletPeerInfoRequest({
      peerNpub,
      requesterNpub: me,
      post,
      getMyEvmAddress: async () =>
        (await getActiveEvmSignerAddress())?.trim() || (await getEvmAddress())?.trim() || '',
    });
    if (npub !== peerNpub) return;
    if (result.ok) {
      showToast(tFn('wallet.requestSent'));
      return;
    }
    if (result.code === 'in_flight') return;
    if (result.code === 'no_address') {
      showToast(tFn('wallet.addOrSelectWallet'));
      return;
    }
    showToast(
      result.code === 'error'
        ? tFn('wallet.couldNotSendRequestShort')
        : tFn('wallet.couldNotSendRequest'),
    );
  }

  function reloadWatchedRows() {
    watchedErc20Rows = loadWatchedErc20Rows(accountNpub);
  }

  $effect(() => {
    void accountNpub;
    void $walletWatchedTokensTick;
    reloadWatchedRows();
    void (async () => {
      const npubAtStart = accountNpub;
      const address =
        (await getActiveEvmSignerAddress())?.trim() || (await getEvmAddress())?.trim() || null;
      if (accountNpub !== npubAtStart) return;
      ownerAddress = address;
    })();
  });

  const enabledChainSet = $derived.by(() => {
    void $walletUiEnabledChainsTick;
    return new Set(loadWalletEnabledChains(accountNpub));
  });

  /** If the stored filter points at a chain the user disabled in Wallet view, fall back to "all". */
  $effect(() => {
    const next = coerceNetworkFilter(networkFilter, enabledChainSet);
    if (next === networkFilter) return;
    networkFilter = next;
    saveNetworkFilter(WALLET_BAR_NETWORK_FILTER_PREFIX, next);
  });

  const networksForBalance = $derived(networksForBalanceList(summary, networkFilter, enabledChainSet));


  /**
   * Network dropdown matches Wallet settings toggles (enabled chains), not only chains that appear
   * in the latest summary (zero-balance or missing RPC rows would otherwise disappear from the list).
   */
  const networkDropdownChainIds = $derived(
    WALLET_ASSETS_CHAIN_IDS.filter((id) => enabledChainSet.has(id))
  );

  /** Total USD for listed networks only (matches toggles in Wallet view). */
  const barPricing = $derived(summaryPricing(summary, networkFilter, networksForBalance));
  const barPricingStatus = $derived(barPricing.status);
  const barTotalUsdApprox = $derived(barPricing.total);

  async function refreshSummary() {
    const wire = watchedRowsToWire(watchedErc20Rows);
    const preCached = accountNpub ? getMatchingCachedSummary(accountNpub, wire) : null;

    if (!accountNpub) {
      summary = null;
      summaryError = null;
      summaryLoading = false;
      return;
    }

    if (preCached) {
      summary = preCached;
      summaryError = null;
    } else {
      summaryError = null;
    }

    const hadDisplay = summary != null;
    summaryLoading = true;

    const enabledChains = loadWalletEnabledChains(accountNpub);
    const r = await getWalletSummary(wire, enabledChains);
    if (r.ok) {
      summary = r.summary;
      summaryError = null;
      persistWalletSummaryCache(accountNpub, wire, r.summary);
    } else {
      summaryError = r.message;
      if (!hadDisplay && !preCached) summary = null;
    }
    summaryLoading = false;
  }

  onMount(() => {
    networkFilter = loadNetworkFilter(WALLET_BAR_NETWORK_FILTER_PREFIX);
    refreshSummary();
    const unsub = walletSendPrefillFromRequest.subscribe((v: WalletSendPrefillPayload | null) => {
      if (!v || v.targetNpub !== npub) return;
      walletSendPrefillFromRequest.set(null);
      sendModalPrefill = v;
      sendModalOpen = true;
    });
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshSummary();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      unsub();
    };
  });

  function closeSendModal() {
    sendModalOpen = false;
    sendModalPrefill = null;
  }
</script>

<aside id="wallet-bar" class="wallet-bar" aria-label={$t('wallet.walletTitle')}>
  <div class="wallet-bar-header">
    <h2 class="wallet-bar-title">{$t('wallet.walletTitle')}</h2>
  </div>

  <section class="wallet-bar-section" aria-labelledby="wallet-balance-heading">
    <div class="wallet-bar-section-head">
      <h3 id="wallet-balance-heading" class="wallet-bar-section-title">{$t('wallet.balanceTitle')}</h3>
      <RefreshIconButton
        disabled={summaryLoading}
        spinning={summaryLoading}
        ariaLabel={summaryLoading ? $t('wallet.refreshingBalances') : $t('wallet.refreshBalances')}
        onclick={refreshSummary}
      />
    </div>
    {#if summaryLoading && !summary}
      <p class="wallet-bar-placeholder">{$t('wallet.loadingBalances')}</p>
    {:else if summary}
      {#if summaryError}
        <p class="wallet-bar-stale" role="status">
          {$t('wallet.couldNotRefreshBalances')}
          <span class="wallet-bar-stale-detail">{summaryError}</span>
        </p>
      {/if}
      <p class="wallet-bar-total">
        {#if barPricingStatus === 'unavailable' || barTotalUsdApprox == null}
          {$t('wallet.totalUsdUnavailable')}
        {:else if barPricingStatus === 'partial'}
          {$t('wallet.totalUsdPartial')}
          <strong>${barTotalUsdApprox.toFixed(2)}</strong>
        {:else}
          {$t('wallet.totalApprox')}
          <strong>${barTotalUsdApprox.toFixed(2)}</strong>
        {/if}
      </p>
      <WalletBalanceList
        enabledChainIds={networkDropdownChainIds}
        {networkFilter}
        networks={networksForBalance}
        onNetworkFilter={(next) => {
          networkFilter = next;
          saveNetworkFilter(WALLET_BAR_NETWORK_FILTER_PREFIX, next);
        }}
        onAddTokens={() => (importTokensModalOpen = true)}
      />
    {:else if summaryError}
      <p class="wallet-bar-error" role="alert">{summaryError}</p>
    {:else}
      <p class="wallet-bar-placeholder">{$t('wallet.noBalanceData')}</p>
    {/if}
  </section>

  {#if !peerWalletReady}
    <div class="wallet-bar-init">
      <p class="wallet-bar-init-text">{$t('wallet.exchangeAddressesLine')}</p>
      <button
        type="button"
        class="wallet-bar-btn wallet-bar-btn-primary wallet-bar-btn-full"
        disabled={peerInfoRequestInFlight || !$currentUser}
        onclick={sendWalletInfoRequest}
      >
        {peerInfoRequestInFlight ? $t('wallet.sending') : $t('wallet.sendExchangeRequest')}
      </button>
    </div>
  {:else}
    <div class="wallet-bar-actions">
      <button
        type="button"
        class="wallet-bar-btn wallet-bar-btn-primary"
        onclick={() => {
          sendModalPrefill = null;
          sendModalOpen = true;
        }}
      >
        {$t('wallet.send')}
      </button>
      <button type="button" class="wallet-bar-btn wallet-bar-btn-secondary" onclick={() => (requestModalOpen = true)}>
        {$t('wallet.request')}
      </button>
    </div>
  {/if}
</aside>

{#if sendModalOpen}
  <WalletSendModal
    {npub}
    peerDisplayName={contactDisplayName}
    watchedAssetRows={watchedErc20Rows}
    formPrefill={sendModalPrefill}
    onClose={closeSendModal}
    {postDmPlaintext}
    onBalanceRefresh={refreshSummary}
  />
{/if}
{#if requestModalOpen}
  <WalletRequestModal
    {npub}
    peerDisplayName={contactDisplayName}
    watchedAssetRows={watchedErc20Rows}
    postDmPlaintext={postDmPlaintext}
    onClose={() => (requestModalOpen = false)}
  />
{/if}
<WalletImportTokensModal
  open={importTokensModalOpen}
  accountNpub={accountNpub}
  {ownerAddress}
  enabledChainIds={networkDropdownChainIds}
  onClose={() => (importTokensModalOpen = false)}
  onSaved={() => {
    reloadWatchedRows();
    refreshSummary();
  }}
/>

<style>
  .wallet-bar {
    flex: 1;
    min-width: 0;
    width: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-hover);
    box-sizing: border-box;
  }

  .wallet-bar-header {
    display: flex;
    align-items: center;
    padding: 14px 16px;
    border-bottom: 1px solid var(--bg-elevated);
    flex-shrink: 0;
  }

  .wallet-bar-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .wallet-bar-section {
    padding: 16px;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .wallet-bar-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }

  .wallet-bar-section-head .wallet-bar-section-title {
    margin-bottom: 0;
  }

  .wallet-bar-section-title {
    margin: 0 0 8px;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .wallet-bar-total {
    margin: 0 0 12px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .wallet-bar-total strong {
    color: var(--text-primary);
  }

  .wallet-bar-stale {
    margin: 0 0 12px;
    padding: 8px 10px;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--text-secondary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .wallet-bar-stale-detail {
    display: block;
    margin-top: 4px;
    font-size: 0.6875rem;
    color: var(--text-muted);
  }

  .wallet-bar-error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--error, #c44);
    line-height: 1.35;
  }

  .wallet-bar-placeholder {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .wallet-bar-init {
    padding: 12px 16px 16px;
    flex-shrink: 0;
    border-top: 1px solid var(--bg-elevated);
  }

  .wallet-bar-init-text {
    margin: 0 0 12px;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .wallet-bar-btn-full {
    width: 100%;
  }

  .wallet-bar-actions {
    padding: 12px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
    border-top: 1px solid var(--bg-elevated);
  }

  .wallet-bar-btn {
    width: 100%;
    padding: 10px 14px;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-family: inherit;
  }

  .wallet-bar-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .wallet-bar-btn-primary {
    background-color: var(--brand);
    color: var(--on-brand);
  }

  .wallet-bar-btn-secondary {
    background-color: var(--border);
    color: var(--text-primary);
  }
</style>
