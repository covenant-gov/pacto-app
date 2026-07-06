<script lang="ts">
  import { WALLET_ASSETS_CHAIN_IDS, WALLET_CHAIN_GROUPS, getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import type { SupportedChainId } from '../../lib/wallet/chains';
  import {
    DEFAULT_PREFERRED_NETWORK,
    loadPreferredNetwork,
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

  export let accountNpub: string | null = null;
  export let enabledSet: Set<SupportedChainId>;
  export let watchedRows: WatchedErc20Row[] = [];
  /** `all` or one enabled chain; defaults to preferred network per account. */
  export let tokenNetworkFilter: 'all' | SupportedChainId = DEFAULT_PREFERRED_NETWORK;
  export let onToggleChain: (chain: SupportedChainId) => void = () => {};
  export let onRemoveWatchedRow: (row: WatchedErc20Row) => void = () => {};
  export let onImportTokens: () => void = () => {};

  let tokenFilterInitializedFor: string | null = null;
  let lastPreferred: PreferredNetworkId = DEFAULT_PREFERRED_NETWORK;
  let preferredNetwork: PreferredNetworkId = DEFAULT_PREFERRED_NETWORK;
  let rpcNetworkFilter: SupportedChainId = DEFAULT_PREFERRED_NETWORK;
  let rpcFilterInitializedFor: string | null = null;
  let personalRpcs: string[] = [];
  let defaultRpcOptions: ReturnType<typeof listDefaultRpcOptions> = [];
  let selectedDefaultRpc = '';
  let newRpcUrl = '';
  let addRpcError: string | null = null;

  $: enabledChainIdsOrdered = WALLET_ASSETS_CHAIN_IDS.filter((id) => enabledSet.has(id));

  $: {
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
  }

  // Prefer the user's preferred network, but never show a disabled chain in the
  // filter: fall back to the first enabled chain when the preferred one is off.
  $: rpcFilterFallback = enabledSet.has(preferredNetwork)
    ? preferredNetwork
    : enabledChainIdsOrdered[0] ?? preferredNetwork;
  $: if (!enabledSet.has(rpcNetworkFilter)) {
    rpcNetworkFilter = rpcFilterFallback;
  }
  $: if (tokenNetworkFilter !== 'all' && !enabledSet.has(tokenNetworkFilter)) {
    tokenNetworkFilter = 'all';
  }

  $: filteredWatchedRows =
    tokenNetworkFilter === 'all'
      ? watchedRows
      : watchedRows.filter((row) => row.network === tokenNetworkFilter);

  const ALCHEMY_SIGNUP_URL = 'https://www.alchemy.com/';
  const POCKET_SIGNUP_URL = 'https://pocket.network/';

  $: if (accountNpub) {
    void $walletRpcPrefsTick;
    personalRpcs = listPersonalRpcs(accountNpub, rpcNetworkFilter);
    defaultRpcOptions = listDefaultRpcOptions(accountNpub, rpcNetworkFilter);
    selectedDefaultRpc = loadDefaultRpc(accountNpub, rpcNetworkFilter) ?? '';
  } else {
    personalRpcs = [];
    defaultRpcOptions = [];
    selectedDefaultRpc = '';
  }

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

  function submitAddRpc() {
    addRpcError = null;
    if (!accountNpub) return;
    const result = addPersonalRpc(accountNpub, rpcNetworkFilter, newRpcUrl);
    if (!result.ok) {
      addRpcError = result.error;
      return;
    }
    newRpcUrl = '';
    showToast('Personal RPC added.');
  }

  function onRemovePersonalRpc(url: string) {
    if (!accountNpub) return;
    removePersonalRpc(accountNpub, rpcNetworkFilter, url);
    showToast('Personal RPC removed.');
  }
</script>

<section class="evm-extras-section evm-extras-section--first" aria-labelledby="wallet-networks-heading">
  <h2 id="wallet-networks-heading" class="evm-extras-h2">Enabled chains</h2>
  <p class="evm-extras-hint">
    Enable chains you use. At least one must stay on. Affects Send, balances, and the DM wallet sidebar.
  </p>
  <div class="evm-extras-chain-groups">
    {#each WALLET_CHAIN_GROUPS as group (group.id)}
      <div class="evm-extras-chain-group">
        <h3 class="evm-extras-chain-group-label">{group.label}</h3>
        <ul class="evm-extras-toggle-list">
          {#each group.chains as chain (chain)}
            <li>
              <label class="evm-extras-toggle">
                <input
                  type="checkbox"
                  checked={enabledSet.has(chain)}
                  disabled={enabledSet.has(chain) && enabledSet.size <= 1}
                  on:change={() => onToggleChain(chain)}
                />
                <span>{getWalletNetworkDisplayName(chain)}</span>
              </label>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>
</section>

<section class="evm-extras-section" aria-labelledby="wallet-tokens-heading">
  <div class="evm-extras-section-head">
    <h2 id="wallet-tokens-heading" class="evm-extras-h2">Tokens to track</h2>
    <button type="button" class="evm-extras-btn" on:click={onImportTokens}>Import tokens</button>
  </div>
  <p class="evm-extras-hint">Tracked assets appear in Send and in the DM wallet sidebar (per network).</p>
  <div class="evm-extras-token-filters">
    <label class="evm-extras-filter-label" for="evm-token-network-select">Network</label>
    <select id="evm-token-network-select" class="evm-extras-select" bind:value={tokenNetworkFilter}>
      <option value="all">All networks</option>
      {#each enabledChainIdsOrdered as chainId (chainId)}
        <option value={chainId}>
          {getWalletNetworkDisplayName(chainId)}
        </option>
      {/each}
    </select>
  </div>
  {#if watchedRows.length === 0}
    <p class="evm-extras-empty">No extra tokens yet. Native ETH balances still show when RPCs are available.</p>
  {:else if filteredWatchedRows.length === 0}
    <p class="evm-extras-empty">
      No tokens tracked on {tokenNetworkFilter === 'all' ? 'this filter' : getWalletNetworkDisplayName(tokenNetworkFilter)}.
    </p>
  {:else}
    <ul class="evm-extras-token-list">
      {#each filteredWatchedRows as row (row.id)}
        <li class="evm-extras-token-row">
          <div class="evm-extras-token-meta">
            <span class="evm-extras-token-sym">{row.symbol}</span>
            <span class="evm-extras-token-net">{getWalletNetworkDisplayName(row.network)}</span>
            <code class="evm-extras-token-addr">{row.address.slice(0, 10)}…{row.address.slice(-6)}</code>
            <span class="evm-extras-token-src">{row.source}</span>
          </div>
          <button type="button" class="evm-extras-btn-text" on:click={() => onRemoveWatchedRow(row)}>Remove</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="evm-extras-section" aria-labelledby="wallet-rpc-heading">
  <h2 id="wallet-rpc-heading" class="evm-extras-h2">RPC endpoints</h2>
  <p class="evm-extras-hint">
    Choose which JSON-RPC endpoint Pacto uses for balances, reads, and on-chain actions on each network.
  </p>

  <div class="evm-extras-token-filters">
    <label class="evm-extras-filter-label" for="evm-rpc-network-select">Network</label>
    <select id="evm-rpc-network-select" class="evm-extras-select" bind:value={rpcNetworkFilter}>
      {#each enabledChainIdsOrdered as chainId (chainId)}
        <option value={chainId}>
          {getWalletNetworkDisplayName(chainId)}
        </option>
      {/each}
    </select>
  </div>

  <div class="evm-extras-rpc-block">
    <h3 class="evm-extras-h3">Personal RPC</h3>
    {#if personalRpcs.length === 0}
      <p class="evm-extras-empty evm-extras-rpc-empty">
        No personal RPC yet.
        <button type="button" class="evm-extras-inline-link" on:click={openAlchemySignup}>
          Get a free RPC
        </button>
        from a provider below, then paste it under Add RPC.
      </p>
    {:else}
      <ul class="evm-extras-rpc-list">
        {#each personalRpcs as url (url)}
          <li class="evm-extras-rpc-row">
            <code class="evm-extras-rpc-url" title={url}>{formatRpcDisplay(url)}</code>
            <button type="button" class="evm-extras-btn-text" on:click={() => onRemovePersonalRpc(url)}>
              Remove
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="evm-extras-rpc-block">
    <h3 class="evm-extras-h3">Add RPC</h3>
    <div class="evm-extras-rpc-add">
      <input
        id="evm-add-rpc-input"
        class="evm-extras-input"
        type="url"
        inputmode="url"
        autocomplete="off"
        placeholder="https://…"
        bind:value={newRpcUrl}
        on:keydown={(e) => e.key === 'Enter' && submitAddRpc()}
      />
      <button type="button" class="evm-extras-btn" on:click={submitAddRpc}>Add</button>
    </div>
    {#if addRpcError}
      <p class="evm-extras-field-error" role="alert">{addRpcError}</p>
    {/if}
  </div>

  <div class="evm-extras-rpc-block">
    <label class="evm-extras-filter-label" for="evm-default-rpc-select">Default RPC</label>
    <select
      id="evm-default-rpc-select"
      class="evm-extras-select evm-extras-select--wide"
      bind:value={selectedDefaultRpc}
      on:change={onDefaultRpcChange}
    >
      <option value="">Curated defaults (automatic)</option>
      {#each defaultRpcOptions as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
    <p class="evm-extras-field-hint">Includes your personal RPCs and curated public endpoints for this network.</p>
  </div>

  <div class="evm-extras-rpc-providers">
    <div class="evm-extras-rpc-providers-head">
      <h3 class="evm-extras-h3">RPC API Providers</h3>
      <div class="evm-extras-provider-buttons">
        <button type="button" class="evm-extras-btn evm-extras-btn-secondary" on:click={openAlchemySignup}>
          Alchemy
        </button>
        <span class="evm-extras-provider-sep" aria-hidden="true">|</span>
        <button type="button" class="evm-extras-btn evm-extras-btn-secondary" on:click={openPocketSignup}>
          Pocket
        </button>
      </div>
    </div>
    <p class="evm-extras-field-hint">
      These providers offer free subscriptions that have high enough limits for basic squad on-chain activities.
    </p>
  </div>
</section>

<section class="evm-extras-section evm-extras-section--last" aria-labelledby="wallet-external-heading">
  <h2 id="wallet-external-heading" class="evm-extras-h2">Using this address in an external wallet</h2>
  <div class="evm-extras-external-copy">
    <p>
      If you want to use the same key pair outside Pacto, import your private key into a well-established wallet app
      (MetaMask, Rabby, etc.). Export one key at a time from the account list above.
    </p>
    <p>
      Pacto is built primarily for <strong>governance</strong> with an in-app wallet for squad operations—not for
      browsing arbitrary DeFi or unreviewed smart contracts. If you need that kind of power-user activity, a dedicated
      external wallet is a better fit; Pacto is not designed to be your everyday wallet across the whole ecosystem.
    </p>
  </div>
</section>

<style>
  .evm-extras-section {
    margin-bottom: 28px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .evm-extras-section--first {
    padding-top: 24px;
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
    margin-bottom: 8px;
  }

  .evm-extras-h2 {
    margin: 0 0 8px;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .evm-extras-section-head .evm-extras-h2 {
    margin-bottom: 0;
  }

  .evm-extras-hint {
    margin: 0 0 14px;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .evm-extras-token-filters {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 14px;
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
    outline: 2px solid var(--accent);
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
    margin-bottom: 18px;
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

  .evm-extras-rpc-empty {
    margin: 0;
  }

  .evm-extras-inline-link {
    display: inline;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
  }

  .evm-extras-inline-link:hover {
    color: var(--accent-hover);
  }

  .evm-extras-rpc-add {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  }

  .evm-extras-input {
    flex: 1;
    min-width: 220px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.875rem;
    font-family: inherit;
  }

  .evm-extras-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .evm-extras-field-error {
    margin: 8px 0 0;
    font-size: 0.8125rem;
    color: var(--danger);
  }

  .evm-extras-field-hint {
    margin: 8px 0 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .evm-extras-rpc-providers {
    margin-top: 8px;
    padding-top: 18px;
    border-top: 1px solid var(--border-subtle);
  }

  .evm-extras-rpc-providers-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 6px;
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

  .evm-extras-chain-groups {
    display: flex;
    flex-direction: column;
    gap: 16px;
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
    accent-color: var(--accent);
  }

  .evm-extras-btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    font-size: 0.875rem;
    font-family: inherit;
    cursor: pointer;
  }

  .evm-extras-btn:hover {
    background: var(--accent-hover);
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
    gap: 8px;
  }

  .evm-extras-token-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
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

  .evm-extras-code {
    font-size: 0.8em;
    padding: 2px 6px;
    background: var(--bg-elevated);
    border-radius: 4px;
    word-break: break-all;
  }

  .evm-extras-external-copy {
    padding: 16px 18px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
  }

  .evm-extras-external-copy p {
    margin: 0 0 12px 0;
    font-size: 0.875rem;
    line-height: 1.55;
    color: var(--text-secondary);
  }

  .evm-extras-external-copy p:last-child {
    margin-bottom: 0;
  }
</style>
