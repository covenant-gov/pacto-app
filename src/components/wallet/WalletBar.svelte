<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { invoke } from '@tauri-apps/api/core';
  import { getEvmAddress } from '../../lib/api/auth';
  import { getDmPeerEvmAddress } from '../../lib/api/wallet-peers';
  import { formatWalletPeerInfoRequest } from '../../lib/wallet/dm-messages';
  import { profiles } from '../../stores/profiles';
  import { currentUser } from '../../stores/auth';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../lib/utils/profile';
  import {
    getWalletSummary,
    getWalletNetworkDisplayName,
    WALLET_ASSETS_CHAIN_IDS,
    watchedRowsToWire,
    loadWatchedErc20Rows,
    defaultWatchedErc20Rows,
    type WalletSummary,
    type WalletSummaryNetwork,
    type WalletSummaryAsset,
    type SupportedChainId,
    type WalletTransferSuccessDetail,
    type WatchedErc20Row,
    getMatchingCachedSummary,
    persistWalletSummaryCache,
  } from '../../lib/wallet';
  import { loadWalletEnabledChains, walletUiEnabledChainsTick } from '../../lib/wallet/wallet-ui-prefs';
  import { formatWalletTxAnnouncement } from '../../lib/wallet/dm-messages';
  import { getActiveEvmSignerAddress } from '../../lib/wallet/evm-accounts';
  import { showToast } from '../../stores/toast';
  import {
    walletSendPrefillFromRequest,
    dmWalletPeerExchangeTick,
    type WalletSendPrefillPayload,
  } from '../../stores/app';
  import WalletSendModal from './WalletSendModal.svelte';
  import WalletRequestModal from './WalletRequestModal.svelte';
  import WalletImportTokensModal from './WalletImportTokensModal.svelte';

  /** Active DM counterparty npub */
  export let npub: string;

  /** Send structured DM text to the active thread (same path as the composer). Used for `wallet_tx_announcement` after a confirmed send. */
  export let postDmPlaintext: ((content: string) => Promise<boolean>) | undefined = undefined;

  let sendModalOpen = false;
  let requestModalOpen = false;
  let importTokensModalOpen = false;
  /** Form prefill when opening Send from Accept on a payment request card. */
  let sendModalPrefill: WalletSendPrefillPayload | null = null;

  function truncateNpub(n: string): string {
    if (n.length <= 16) return n;
    return n.slice(0, 8) + '…' + n.slice(-4);
  }

  $: contactProfile = npub ? $profiles[npub] : null;
  $: contactAvatarSrc = getProfileAvatarSrc(contactProfile);
  $: contactDisplayName = contactProfile
    ? getProfileDisplayName(contactProfile)
    : npub
      ? truncateNpub(npub)
      : 'Unknown';

  let summaryLoading = true;
  let summaryError: string | null = null;
  let summary: WalletSummary | null = null;

  const STORAGE_NETWORK = 'pacto_wallet_bar_network_filter';

  /** `all` = every chain; otherwise one `SupportedChainId`. */
  let networkFilter: 'all' | SupportedChainId = 'all';

  function parseNetworkFilter(raw: string | null): 'all' | SupportedChainId {
    if (!raw || raw === 'all') return 'all';
    if (WALLET_ASSETS_CHAIN_IDS.includes(raw as SupportedChainId)) return raw as SupportedChainId;
    return 'all';
  }

  function loadWalletBarPrefs() {
    if (typeof localStorage === 'undefined') return;
    networkFilter = parseNetworkFilter(localStorage.getItem(STORAGE_NETWORK));
  }

  function saveNetworkFilter() {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_NETWORK, networkFilter);
  }

  /** Logged-in account: watched ERC-20 list is keyed by this npub. */
  $: accountNpub = $currentUser?.npub ?? null;

  let watchedErc20Rows: WatchedErc20Row[] = [];

  let peerWalletReady = false;
  let walletInfoRequestSending = false;

  const EVM_PAYOUT_RE = /^0x[a-fA-F0-9]{40}$/;

  /** Same resolution as send: `dm_peer_evm`, then peer profile `evm_address` (Kind 0). */
  async function syncPeerWalletReady() {
    if (!npub) {
      peerWalletReady = false;
      return;
    }
    try {
      const fromDm = await getDmPeerEvmAddress(npub);
      if (fromDm?.trim()) {
        peerWalletReady = true;
        return;
      }
    } catch {
      /* fall through */
    }
    const fromStore = contactProfile?.evm_address?.trim() ?? '';
    if (EVM_PAYOUT_RE.test(fromStore)) {
      peerWalletReady = true;
      return;
    }
    try {
      const p = (await invoke('get_profile', { npub })) as { evm_address?: string; evmAddress?: string };
      const a = (p?.evm_address ?? p?.evmAddress ?? '').trim();
      peerWalletReady = EVM_PAYOUT_RE.test(a);
    } catch {
      peerWalletReady = false;
    }
  }

  $: npub, contactProfile, $dmWalletPeerExchangeTick, void syncPeerWalletReady();

  async function sendWalletInfoRequest() {
    const me = get(currentUser)?.npub;
    if (!me || !npub || walletInfoRequestSending) return;
    if (peerWalletReady) {
      showToast('You already have a payout address for this contact.');
      return;
    }
    const post = postDmPlaintext;
    if (!post) {
      showToast('Use the desktop app to send this request.');
      return;
    }
    walletInfoRequestSending = true;
    try {
      const addr =
        (await getActiveEvmSignerAddress())?.trim() || (await getEvmAddress())?.trim() || '';
      if (!addr) {
        showToast('Your wallet address is not ready yet.');
        return;
      }
      const json = formatWalletPeerInfoRequest({
        request_id: crypto.randomUUID(),
        requester_npub: me,
        requester_evm_address: addr.trim(),
      });
      const ok = await post(json);
      if (ok) {
        showToast('Request sent. Waiting for your contact to accept.');
      } else {
        showToast('Could not send the request. Check your connection.');
      }
    } catch {
      showToast('Could not send the request.');
    } finally {
      walletInfoRequestSending = false;
    }
  }

  function reloadWatchedRows() {
    watchedErc20Rows = accountNpub
      ? loadWatchedErc20Rows(accountNpub)
      : defaultWatchedErc20Rows();
  }

  $: {
    accountNpub;
    reloadWatchedRows();
  }

  let enabledChainSet: Set<SupportedChainId> = new Set(WALLET_ASSETS_CHAIN_IDS as SupportedChainId[]);
  $: {
    void accountNpub;
    void $walletUiEnabledChainsTick;
    enabledChainSet = new Set(
      accountNpub ? loadWalletEnabledChains(accountNpub) : [...WALLET_ASSETS_CHAIN_IDS]
    );
  }

  /** If the stored filter points at a chain the user disabled in Wallet view, fall back to "all". */
  $: if (networkFilter !== 'all' && !enabledChainSet.has(networkFilter)) {
    networkFilter = 'all';
    saveNetworkFilter();
  }

  function networksForBalanceList(
    s: WalletSummary | null,
    filter: 'all' | SupportedChainId,
    enabled: Set<SupportedChainId>
  ): WalletSummaryNetwork[] {
    if (!s) return [];
    const nets = s.networks.filter((n) => enabled.has(n.network as SupportedChainId));
    return nets.filter((n) => (filter === 'all' ? true : n.network === filter));
  }

  let networksForBalance: WalletSummaryNetwork[] = [];
  $: networksForBalance = networksForBalanceList(summary, networkFilter, enabledChainSet);

  /**
   * Network dropdown matches Wallet settings toggles (enabled chains), not only chains that appear
   * in the latest summary (zero-balance or missing RPC rows would otherwise disappear from the list).
   */
  let networkDropdownChainIds: SupportedChainId[] = [];
  $: networkDropdownChainIds = WALLET_ASSETS_CHAIN_IDS.filter((id) => enabledChainSet.has(id));

  /** Total USD for listed networks only (matches toggles in Wallet view). */
  let barTotalUsdApprox: number = 0;
  $: barTotalUsdApprox = networksForBalance.reduce(
    (sum, net) =>
      sum +
      net.assets.reduce((s, a) => s + ((a as WalletSummaryAsset).usdValue ?? 0), 0),
    0
  );

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

    const r = await getWalletSummary(wire);
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

  async function handleWalletTransferSuccess(detail: WalletTransferSuccessDetail) {
    await refreshSummary();
    const me = get(currentUser)?.npub;
    const sendPlain = postDmPlaintext;
    if (!sendPlain) return;
    if (!me) {
      showToast('Transfer confirmed. Sign in to post the payment note to this chat.');
      return;
    }
    const { result, network, asset, amount } = detail;
    const fromEvm = await getActiveEvmSignerAddress();
    if (!fromEvm) {
      showToast(
        'Transfer confirmed, but the payment note was skipped (active EVM address unavailable).'
      );
      return;
    }
    const content = formatWalletTxAnnouncement({
      network,
      asset,
      amount,
      tx_hash: result.txHash,
      from_npub: me,
      to_npub: npub,
      from_evm_address: fromEvm,
      ...(detail.requestId != null && detail.requestId !== ''
        ? { request_id: detail.requestId }
        : {}),
      ...(result.blockNumber != null && result.blockNumber !== ''
        ? { block_number: result.blockNumber }
        : {}),
    });
    try {
      const ok = await sendPlain(content);
      if (!ok) {
        showToast(
          'Transfer confirmed, but the payment note could not be sent. You can mention it manually in chat.'
        );
      }
    } catch {
      showToast('Transfer confirmed, but the payment note could not be sent.');
    }
  }

  onMount(() => {
    loadWalletBarPrefs();
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

<aside id="wallet-bar" class="wallet-bar" aria-label="Wallet">
  <div class="wallet-bar-header">
    <h2 class="wallet-bar-title">Wallet</h2>
  </div>

  <div class="wallet-bar-peer">
    <p class="wallet-bar-peer-label">With this chat</p>
    <div class="wallet-bar-peer-row">
      <div class="wallet-bar-peer-avatar">
        {#if contactAvatarSrc}
          <img src={contactAvatarSrc} alt="" class="wallet-bar-peer-avatar-img" />
        {:else}
          <span class="wallet-bar-peer-placeholder">{contactDisplayName.charAt(0).toUpperCase()}</span>
        {/if}
      </div>
      <div class="wallet-bar-peer-text">
        <span class="wallet-bar-peer-name">{contactDisplayName}</span>
        <span class="wallet-bar-peer-npub">{truncateNpub(npub)}</span>
      </div>
    </div>
    <p class="wallet-bar-hint">
      {#if peerWalletReady}
        Send and Request use this contact. Use the wallet button in the chat header to hide this panel.
      {:else}
        First exchange payout addresses privately with this contact, then you can send or request payment.
      {/if}
    </p>
  </div>

  <section class="wallet-bar-section" aria-labelledby="wallet-balance-heading">
    <div class="wallet-bar-section-head">
      <h3 id="wallet-balance-heading" class="wallet-bar-section-title">Balance</h3>
      <button
        type="button"
        class="wallet-bar-refresh"
        disabled={summaryLoading}
        on:click={refreshSummary}
        aria-label="Refresh balances"
      >
        {summaryLoading ? '…' : 'Refresh'}
      </button>
    </div>
    {#if summaryLoading && !summary}
      <p class="wallet-bar-placeholder">Loading balances…</p>
    {:else if summary}
      {#if summaryError}
        <p class="wallet-bar-stale" role="status">
          Could not refresh balances. Showing last known amounts.
          <span class="wallet-bar-stale-detail">{summaryError}</span>
        </p>
      {/if}
      <div class="wallet-bar-filters">
        <label class="wallet-bar-filter-label" for="wallet-bar-network-select">Network</label>
        <select
          id="wallet-bar-network-select"
          class="wallet-bar-select"
          bind:value={networkFilter}
          on:change={saveNetworkFilter}
        >
          <option value="all">All enabled networks</option>
          {#each networkDropdownChainIds as chainId (chainId)}
            <option value={chainId}>{getWalletNetworkDisplayName(chainId)}</option>
          {/each}
        </select>
        <button
          type="button"
          class="wallet-bar-btn wallet-bar-btn-import"
          on:click={() => (importTokensModalOpen = true)}
        >
          Import tokens
        </button>
      </div>
      <p class="wallet-bar-total">
        Total (approx.) <strong>${barTotalUsdApprox.toFixed(2)}</strong>
        <span class="wallet-bar-total-meta">via {summary.prices.source}</span>
      </p>
      {#if networksForBalance.length === 0}
        <p class="wallet-bar-placeholder">No networks match this filter.</p>
      {:else}
        <ul class="wallet-bar-netlist">
          {#each networksForBalance as net (net.network)}
            {@const n = net as WalletSummaryNetwork}
            <li class="wallet-bar-net">
              {#if networkFilter === 'all'}
                <span class="wallet-bar-net-name"
                  >{getWalletNetworkDisplayName(n.network as SupportedChainId)}</span
                >
              {/if}
              <ul class="wallet-bar-assets">
                {#each n.assets as a, i (`${n.network}-${(a as WalletSummaryAsset).symbol}-${i}`)}
                  {@const asset = a as WalletSummaryAsset}
                  <li>
                    <span class="wallet-bar-asset-sym">{asset.symbol}</span>
                    <span class="wallet-bar-asset-amt" title={asset.balanceRaw}>{asset.balanceDecimal}</span>
                  </li>
                {/each}
              </ul>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if summaryError}
      <p class="wallet-bar-error" role="alert">{summaryError}</p>
    {:else}
      <p class="wallet-bar-placeholder">No balance data.</p>
    {/if}
  </section>

  {#if !peerWalletReady}
    <div class="wallet-bar-init">
      <p class="wallet-bar-init-text">
        Their payout address for this chat is not on your device yet. Send a private request (your address is
        included). When they accept, both of you can send to each other without a second request.
      </p>
      <button
        type="button"
        class="wallet-bar-btn wallet-bar-btn-primary wallet-bar-btn-full"
        disabled={walletInfoRequestSending || !$currentUser}
        on:click={sendWalletInfoRequest}
      >
        {walletInfoRequestSending ? 'Sending…' : 'Send exchange request'}
      </button>
    </div>
  {:else}
    <div class="wallet-bar-actions">
      <button
        type="button"
        class="wallet-bar-btn wallet-bar-btn-primary"
        on:click={() => {
          sendModalPrefill = null;
          sendModalOpen = true;
        }}
      >
        Send
      </button>
      <button type="button" class="wallet-bar-btn wallet-bar-btn-secondary" on:click={() => (requestModalOpen = true)}>
        Request
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
    onTransferSuccess={handleWalletTransferSuccess}
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
  networkScope={networkFilter}
  accountNpub={accountNpub}
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

  .wallet-bar-peer {
    padding: 16px;
    border-bottom: 1px solid var(--bg-elevated);
    flex-shrink: 0;
  }

  .wallet-bar-peer-label {
    margin: 0 0 10px;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .wallet-bar-peer-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .wallet-bar-peer-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    background-color: var(--border);
  }

  .wallet-bar-peer-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .wallet-bar-peer-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 1rem;
    color: #fff;
    background-color: var(--accent);
  }

  .wallet-bar-peer-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .wallet-bar-peer-name {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wallet-bar-peer-npub {
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-family: ui-monospace, monospace;
  }

  .wallet-bar-hint {
    margin: 10px 0 0;
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.35;
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
    margin: 0;
  }

  .wallet-bar-filters {
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .wallet-bar-filter-label {
    margin: 0;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .wallet-bar-select {
    width: 100%;
    padding: 8px 10px;
    font-size: 0.8125rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-hover);
    color: var(--text-primary);
    font-family: inherit;
    cursor: pointer;
  }

  .wallet-bar-btn-import {
    width: 100%;
    margin-top: 4px;
    padding: 8px 10px;
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-hover);
    color: var(--text-primary);
    cursor: pointer;
    font-family: inherit;
  }

  .wallet-bar-btn-import:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .wallet-bar-section-title {
    margin: 0 0 8px;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .wallet-bar-refresh {
    flex-shrink: 0;
    padding: 4px 8px;
    font-size: 0.6875rem;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg-hover);
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
  }

  .wallet-bar-refresh:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

  .wallet-bar-total-meta {
    display: block;
    margin-top: 4px;
    font-size: 0.6875rem;
    color: var(--text-muted);
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

  .wallet-bar-netlist {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .wallet-bar-net {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .wallet-bar-net-name {
    display: block;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    margin-bottom: 6px;
  }

  .wallet-bar-assets {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .wallet-bar-assets li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.75rem;
    color: var(--text-primary);
    font-family: ui-monospace, monospace;
  }

  .wallet-bar-asset-sym {
    color: var(--text-secondary);
    font-family: inherit;
    font-weight: 500;
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
    background-color: var(--accent);
    color: #fff;
  }

  .wallet-bar-btn-secondary {
    background-color: var(--border);
    color: var(--text-primary);
  }
</style>
