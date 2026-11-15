<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import { WALLET_ASSETS_CHAIN_IDS, WALLET_CHAIN_GROUPS, getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import type { SupportedChainId } from '../../lib/wallet/chains';
  import {
    DEFAULT_PREFERRED_NETWORK,
    listPreferredNetworkOptions,
    loadPreferredNetwork,
    savePreferredNetwork,
    walletPreferredNetworkTick,
    type PreferredNetworkId,
  } from '../../lib/wallet/preferred-network';
  import type { WatchedErc20Row } from '../../lib/wallet/watched-tokens';
  import {
    addPersonalRpc,
    formatRpcDisplay,
    listDefaultRpcOptions,
    listPersonalRpcs,
    loadDefaultRpc,
    removePersonalRpc,
    saveDefaultRpc,
    walletRpcPrefsTick,
  } from '../../lib/wallet/rpc-prefs';
  import { openExternalUrl } from '../../lib/utils/open-external';
  import { showToast } from '../../stores/toast';
  import { shortEvmAddress } from '../../lib/governance/hats-tree-annotations';
  import SettingsFormModal from './SettingsFormModal.svelte';

  const tFn = get(t);

  function tokenSourceLabel(source: string): string {
    return $t(source === 'custom' ? 'settings.tokenSourceCustom' : 'settings.tokenSourceCatalog');
  }

  interface Props {
    accountNpub: string | null;
    enabledSet: Set<SupportedChainId>;
    watchedRows: WatchedErc20Row[];
    /** `all` or one enabled chain; defaults to preferred network per account. */
    tokenNetworkFilter: 'all' | SupportedChainId;
    onToggleChain?: (chain: SupportedChainId) => void;
    onRemoveWatchedRow?: (row: WatchedErc20Row) => void;
    onImportTokens?: () => void;
  }

  let {
    accountNpub = null,
    enabledSet,
    watchedRows = [],
    tokenNetworkFilter = $bindable(DEFAULT_PREFERRED_NETWORK),
    onToggleChain = () => {},
    onRemoveWatchedRow = () => {},
    onImportTokens = () => {},
  }: Props = $props();

  let tokenFilterInitializedFor: string | null = $state(null);
  let lastPreferred: PreferredNetworkId = $state(DEFAULT_PREFERRED_NETWORK);
  let preferredNetwork: PreferredNetworkId = $state(DEFAULT_PREFERRED_NETWORK);
  let rpcNetworkFilter: SupportedChainId = $state(DEFAULT_PREFERRED_NETWORK);
  let rpcFilterInitializedFor: string | null = $state(null);
  let personalRpcs: string[] = $state([]);
  let defaultRpcOptions: ReturnType<typeof listDefaultRpcOptions> = $state([]);
  let selectedDefaultRpc = $state('');
  let newRpcUrl = $state('');
  let addRpcError: string | null = $state(null);
  let addRpcModalOpen = $state(false);
  let enabledChainsMenuOpen = $state(false);

  let enabledChainIdsOrdered = $derived(WALLET_ASSETS_CHAIN_IDS.filter((id) => enabledSet.has(id)));
  let enabledChainsSummary = $derived(
    enabledChainIdsOrdered.map((id) => getWalletNetworkDisplayName(id)).join(', '),
  );

  $effect(() => {
    if (!enabledChainsMenuOpen) return;
    function onDocPointer(e: PointerEvent) {
      const root = document.getElementById('evm-enabled-chains-menu');
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      enabledChainsMenuOpen = false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') enabledChainsMenuOpen = false;
    }
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  });

  $effect(() => {
    void $walletPreferredNetworkTick;
    void $walletRpcPrefsTick;
    preferredNetwork = accountNpub ? loadPreferredNetwork(accountNpub) : DEFAULT_PREFERRED_NETWORK;

    if (accountNpub && accountNpub !== tokenFilterInitializedFor) {
      tokenFilterInitializedFor = accountNpub;
      tokenNetworkFilter = preferredNetwork;
      lastPreferred = preferredNetwork;
    } else if (preferredNetwork !== lastPreferred) {
      if (tokenNetworkFilter === lastPreferred) {
        tokenNetworkFilter = preferredNetwork;
      }
      lastPreferred = preferredNetwork;
    }

    if (accountNpub && accountNpub !== rpcFilterInitializedFor) {
      rpcFilterInitializedFor = accountNpub;
      rpcNetworkFilter = preferredNetwork;
    } else if (preferredNetwork !== lastPreferred && rpcNetworkFilter === lastPreferred) {
      rpcNetworkFilter = preferredNetwork;
    }
  });

  // Prefer the user's preferred network, but never show a disabled chain in the
  // filter: fall back to the first enabled chain when the preferred one is off.
  let rpcFilterFallback = $derived(
    enabledSet.has(preferredNetwork) ? preferredNetwork : enabledChainIdsOrdered[0] ?? preferredNetwork
  );
  $effect(() => {
    if (!enabledSet.has(rpcNetworkFilter)) {
      rpcNetworkFilter = rpcFilterFallback;
    }
  });
  $effect(() => {
    if (tokenNetworkFilter !== 'all' && !enabledSet.has(tokenNetworkFilter)) {
      tokenNetworkFilter = 'all';
    }
  });

  let filteredWatchedRows = $derived(
    tokenNetworkFilter === 'all'
      ? watchedRows.filter((row) => enabledSet.has(row.network as SupportedChainId))
      : watchedRows.filter((row) => row.network === tokenNetworkFilter)
  );

  const ALCHEMY_SIGNUP_URL = 'https://www.alchemy.com/';
  const POCKET_SIGNUP_URL = 'https://pocket.network/';

  $effect(() => {
    if (accountNpub) {
      void $walletRpcPrefsTick;
      personalRpcs = listPersonalRpcs(accountNpub, rpcNetworkFilter);
      defaultRpcOptions = listDefaultRpcOptions(accountNpub, rpcNetworkFilter);
      selectedDefaultRpc = loadDefaultRpc(accountNpub, rpcNetworkFilter) ?? '';
    } else {
      personalRpcs = [];
      defaultRpcOptions = [];
      selectedDefaultRpc = '';
    }
  });

  function openAlchemySignup() {
    openExternalUrl(ALCHEMY_SIGNUP_URL);
  }

  function openPocketSignup() {
    openExternalUrl(POCKET_SIGNUP_URL);
  }

  function onDefaultRpcChange() {
    if (!accountNpub) return;
    saveDefaultRpc(accountNpub, rpcNetworkFilter, selectedDefaultRpc || null);
  }

  function openAddRpcModal() {
    newRpcUrl = '';
    addRpcError = null;
    addRpcModalOpen = true;
  }

  function closeAddRpcModal() {
    addRpcModalOpen = false;
    addRpcError = null;
    newRpcUrl = '';
  }

  function submitAddRpc() {
    addRpcError = null;
    if (!accountNpub) return;
    const result = addPersonalRpc(accountNpub, rpcNetworkFilter, newRpcUrl);
    if (!result.ok) {
      addRpcError = result.error;
      return;
    }
    newRpcUrl = '';
    addRpcModalOpen = false;
    showToast(tFn('settings.toast.personalRpcAdded'));
  }

  function onRemovePersonalRpc(url: string) {
    if (!accountNpub) return;
    removePersonalRpc(accountNpub, rpcNetworkFilter, url);
    showToast(tFn('settings.toast.personalRpcRemoved'));
  }

  const preferredNetworkOptions = listPreferredNetworkOptions();

  function onPreferredNetworkChange(event: Event) {
    if (!accountNpub) return;
    const next = (event.currentTarget as HTMLSelectElement).value as PreferredNetworkId;
    savePreferredNetwork(accountNpub, next);
  }
</script>

<section class="evm-extras-section" aria-labelledby="wallet-preferred-network-heading">
  <h2 id="wallet-preferred-network-heading" class="evm-extras-h2">{$t('wallet.preferredNetworkLabel')}</h2>
  <select
    id="wallet-preferred-network-select"
    class="evm-extras-select"
    aria-labelledby="wallet-preferred-network-heading"
    value={preferredNetwork}
    disabled={!accountNpub}
    onchange={onPreferredNetworkChange}
  >
    {#each preferredNetworkOptions as opt (opt.id)}
      <option value={opt.id}>{opt.label}</option>
    {/each}
  </select>
</section>

<section class="evm-extras-section" aria-labelledby="wallet-networks-heading">
  <h2 id="wallet-networks-heading" class="evm-extras-h2">{$t('settings.enabledChainsTitle')}</h2>
  <div id="evm-enabled-chains-menu" class="evm-extras-chains-menu">
    <button
      type="button"
      id="evm-enabled-chains-trigger"
      class="evm-extras-select evm-extras-chains-trigger"
      aria-haspopup="listbox"
      aria-expanded={enabledChainsMenuOpen}
      aria-label={$t('settings.enabledChainsTitle')}
      onclick={() => (enabledChainsMenuOpen = !enabledChainsMenuOpen)}
    >
      <span class="evm-extras-chains-summary">
        {enabledChainsSummary || $t('settings.noEnabledChains')}
      </span>
      <svg
        class="evm-extras-chains-chevron"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
      >
        <path
          d="M6 9L12 15L18 9"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    {#if enabledChainsMenuOpen}
      <div class="evm-extras-chains-panel" role="listbox" aria-multiselectable="true">
        {#each WALLET_CHAIN_GROUPS as group (group.id)}
          <div class="evm-extras-chain-group">
            <h3 class="evm-extras-chain-group-label">{$t(group.label)}</h3>
            <ul class="evm-extras-toggle-list">
              {#each group.chains as chain (chain)}
                <li>
                  <label class="evm-extras-toggle">
                    <input
                      type="checkbox"
                      checked={enabledSet.has(chain)}
                      disabled={enabledSet.has(chain) && enabledSet.size <= 1}
                      onchange={() => onToggleChain(chain)}
                    />
                    <span>{getWalletNetworkDisplayName(chain)}</span>
                  </label>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>

<section class="evm-extras-section" aria-labelledby="wallet-tokens-heading">
  <div class="evm-extras-section-head">
    <h2 id="wallet-tokens-heading" class="evm-extras-h2">{$t('settings.tokensToTrackTitle')}</h2>
    <button type="button" class="evm-extras-btn" onclick={onImportTokens}>{$t('settings.importTokensButton')}</button>
  </div>
  <div class="evm-extras-token-filters">
    <select
      id="evm-token-network-select"
      class="evm-extras-select"
      aria-label={$t('wallet.networkLabel')}
      bind:value={tokenNetworkFilter}
    >
      <option value="all">{$t('settings.allNetworksOption')}</option>
      {#each enabledChainIdsOrdered as chainId (chainId)}
        <option value={chainId}>
          {getWalletNetworkDisplayName(chainId)}
        </option>
      {/each}
    </select>
  </div>
  {#if watchedRows.length === 0}
    <p class="evm-extras-empty">{$t('settings.noExtraTokensYet')}</p>
  {:else if filteredWatchedRows.length === 0}
    <p class="evm-extras-empty">
      {$t('settings.noTokensOnFilter', { values: { network: tokenNetworkFilter === 'all' ? $t('settings.thisFilterFallback') : getWalletNetworkDisplayName(tokenNetworkFilter) } })}
    </p>
  {:else}
    <ul class="evm-extras-token-list">
      {#each filteredWatchedRows as row (row.id)}
        <li class="evm-extras-token-row">
          <div class="evm-extras-token-meta">
            <span class="evm-extras-token-sym">{row.symbol}</span>
            <span class="evm-extras-token-net">{getWalletNetworkDisplayName(row.network)}</span>
            <code class="evm-extras-token-addr">{shortEvmAddress(row.address)}</code>
            <span class="evm-extras-token-src">{tokenSourceLabel(row.source)}</span>
          </div>
          <button type="button" class="evm-extras-btn-text" onclick={() => onRemoveWatchedRow(row)}>{$t('settings.remove')}</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="evm-extras-section evm-extras-section--last" aria-labelledby="wallet-rpc-heading">
  <h2 id="wallet-rpc-heading" class="evm-extras-h2">{$t('settings.rpcEndpointsTitle')}</h2>

  <div class="evm-extras-token-filters">
    <select
      id="evm-rpc-network-select"
      class="evm-extras-select"
      aria-label={$t('wallet.networkLabel')}
      bind:value={rpcNetworkFilter}
    >
      {#each enabledChainIdsOrdered as chainId (chainId)}
        <option value={chainId}>
          {getWalletNetworkDisplayName(chainId)}
        </option>
      {/each}
    </select>
  </div>

  <div class="evm-extras-rpc-block">
    <div class="evm-extras-section-head">
      <h3 class="evm-extras-h3">{$t('settings.personalRpcTitle')}</h3>
      <button type="button" class="evm-extras-btn" disabled={!accountNpub} onclick={openAddRpcModal}>
        {$t('settings.addRpcTitle')}
      </button>
    </div>
    {#if personalRpcs.length === 0}
      <p class="evm-extras-empty">{$t('settings.noPersonalRpcYet')}</p>
    {:else}
      <ul class="evm-extras-rpc-list">
        {#each personalRpcs as url (url)}
          <li class="evm-extras-rpc-row">
            <code class="evm-extras-rpc-url" title={url}>{formatRpcDisplay(url)}</code>
            <button type="button" class="evm-extras-btn-text" onclick={() => onRemovePersonalRpc(url)}>
              {$t('settings.remove')}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="evm-extras-rpc-block">
    <label class="evm-extras-filter-label" for="evm-default-rpc-select">{$t('settings.defaultRpcTitle')}</label>
    <select
      id="evm-default-rpc-select"
      class="evm-extras-select evm-extras-select--wide"
      bind:value={selectedDefaultRpc}
      onchange={onDefaultRpcChange}
    >
      <option value="">{$t('settings.defaultRpcCuratedDefaults')}</option>
      {#each defaultRpcOptions as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  </div>

  <div class="evm-extras-rpc-providers">
    <div class="evm-extras-rpc-providers-head">
      <h3 class="evm-extras-h3">{$t('settings.rpcApiProvidersTitle')}</h3>
      <div class="evm-extras-provider-buttons">
        <button type="button" class="evm-extras-btn evm-extras-btn-secondary" onclick={openAlchemySignup}>
          {$t('settings.alchemyProvider')}
        </button>
        <span class="evm-extras-provider-sep" aria-hidden="true">|</span>
        <button type="button" class="evm-extras-btn evm-extras-btn-secondary" onclick={openPocketSignup}>
          {$t('settings.pocketProvider')}
        </button>
      </div>
    </div>
  </div>
</section>

{#if addRpcModalOpen}
  <SettingsFormModal
    titleId="settings-add-rpc-title"
    title={$t('settings.addRpcTitle')}
    primaryLabel={$t('settings.addRpcButton')}
    error={addRpcError}
    onClose={closeAddRpcModal}
    onPrimary={submitAddRpc}
  >
    <p class="settings-form-status">
      {$t('wallet.networkLabel')}: {getWalletNetworkDisplayName(rpcNetworkFilter)}
    </p>
    <input
      id="evm-add-rpc-input"
      class="settings-form-input"
      type="url"
      inputmode="url"
      autocomplete="off"
      aria-label={$t('settings.addRpcTitle')}
      placeholder="https://…"
      bind:value={newRpcUrl}
      onkeydown={(e) => e.key === 'Enter' && submitAddRpc()}
    />
  </SettingsFormModal>
{/if}

<style>
  .evm-extras-section {
    margin-bottom: 18px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .evm-extras-section--last {
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 0;
  }

  .evm-extras-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }

  .evm-extras-h2 {
    margin: 0 0 10px;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .evm-extras-section-head .evm-extras-h2,
  .evm-extras-section-head .evm-extras-h3 {
    margin-bottom: 0;
  }

  .evm-extras-token-filters {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }

  .evm-extras-filter-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .evm-extras-select {
    min-width: 200px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.875rem;
    font-family: inherit;
    cursor: pointer;
  }

  .evm-extras-select:focus {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .evm-extras-select--wide {
    width: 100%;
    max-width: 100%;
  }

  .evm-extras-h3 {
    margin: 0 0 8px;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .evm-extras-rpc-block {
    margin-bottom: 12px;
  }

  .evm-extras-rpc-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .evm-extras-rpc-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  .evm-extras-rpc-url {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    word-break: break-all;
  }

  .evm-extras-rpc-providers {
    margin-top: 4px;
    padding-top: 12px;
    border-top: 1px solid var(--border-subtle);
  }

  .evm-extras-rpc-providers-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .evm-extras-provider-buttons {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .evm-extras-provider-sep {
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .evm-extras-chains-menu {
    position: relative;
    max-width: 420px;
  }

  .evm-extras-chains-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    text-align: left;
    cursor: pointer;
  }

  .evm-extras-chains-summary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .evm-extras-chains-chevron {
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .evm-extras-chains-panel {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-height: min(360px, 50vh);
    overflow: auto;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--text-primary) 12%, transparent);
  }

  .evm-extras-chain-group-label {
    margin: 0 0 8px;
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .evm-extras-toggle-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .evm-extras-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .evm-extras-toggle input {
    accent-color: var(--brand);
  }

  .evm-extras-btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    background: var(--brand);
    color: var(--on-brand);
    font-weight: 600;
    font-size: 0.875rem;
    font-family: inherit;
    cursor: pointer;
  }

  .evm-extras-btn:hover {
    background: var(--brand-hover);
  }

  .evm-extras-btn-secondary {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .evm-extras-btn-secondary:hover {
    background: var(--bg-hover);
  }

  .evm-extras-token-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .evm-extras-token-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  .evm-extras-token-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    min-width: 0;
  }

  .evm-extras-token-sym {
    font-weight: 600;
    color: var(--text-primary);
  }

  .evm-extras-token-net {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .evm-extras-token-addr {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .evm-extras-token-src {
    font-size: 0.7rem;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .evm-extras-btn-text {
    background: none;
    border: none;
    color: var(--danger);
    font-size: 0.8125rem;
    font-family: inherit;
    cursor: pointer;
    flex-shrink: 0;
  }

  .evm-extras-btn-text:hover {
    text-decoration: underline;
  }

  .evm-extras-empty {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-muted);
  }
</style>
