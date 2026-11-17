<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import { WALLET_ASSETS_CHAIN_IDS, getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import type { SupportedChainId } from '../../lib/wallet/chains';
  import {
    DEFAULT_PREFERRED_NETWORK,
    listPreferredNetworkOptions,
    loadPreferredNetwork,
    savePreferredNetwork,
    walletPreferredNetworkTick,
    type PreferredNetworkId,
  } from '../../lib/wallet/preferred-network';
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
  import SettingsFormModal from './SettingsFormModal.svelte';
  import EnabledChainsMenu from './EnabledChainsMenu.svelte';

  const tFn = get(t);

  interface Props {
    accountNpub: string | null;
    enabledSet: Set<SupportedChainId>;
    onToggleChain?: (chain: SupportedChainId) => void;
  }

  let {
    accountNpub = null,
    enabledSet,
    onToggleChain = () => {},
  }: Props = $props();

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

  let enabledChainIdsOrdered = $derived(WALLET_ASSETS_CHAIN_IDS.filter((id) => enabledSet.has(id)));

  $effect(() => {
    void $walletPreferredNetworkTick;
    void $walletRpcPrefsTick;
    preferredNetwork = accountNpub ? loadPreferredNetwork(accountNpub) : DEFAULT_PREFERRED_NETWORK;

    if (accountNpub && accountNpub !== rpcFilterInitializedFor) {
      rpcFilterInitializedFor = accountNpub;
      rpcNetworkFilter = preferredNetwork;
      lastPreferred = preferredNetwork;
    } else if (preferredNetwork !== lastPreferred && rpcNetworkFilter === lastPreferred) {
      rpcNetworkFilter = preferredNetwork;
      lastPreferred = preferredNetwork;
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

<section class="evm-extras-section" aria-label={$t('wallet.preferredNetworkLabel')}>
  <div class="ui-field-row">
    <div class="ui-field">
      <label class="ui-field-label" for="wallet-preferred-network-select">{$t('wallet.preferredNetworkLabel')}</label>
      <select
        id="wallet-preferred-network-select"
        class="ui-select"
        value={preferredNetwork}
        disabled={!accountNpub}
        onchange={onPreferredNetworkChange}
      >
        {#each preferredNetworkOptions as opt (opt.id)}
          <option value={opt.id}>{opt.label}</option>
        {/each}
      </select>
    </div>
    <div class="ui-field">
      <span class="ui-field-label" id="wallet-networks-heading">{$t('settings.enabledChainsTitle')}</span>
      <EnabledChainsMenu {enabledSet} labelledBy="wallet-networks-heading" {onToggleChain} />
    </div>
  </div>
</section>

<section class="evm-extras-section evm-extras-section--last" aria-labelledby="wallet-rpc-heading">
  <div class="evm-extras-section-head">
    <h2 id="wallet-rpc-heading" class="evm-extras-h2">{$t('settings.rpcEndpointsTitle')}</h2>
    <select
      id="evm-rpc-network-select"
      class="ui-select evm-extras-select-inline"
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
    <div class="ui-field">
      <label class="ui-field-label" for="evm-default-rpc-select">{$t('settings.defaultRpcTitle')}</label>
      <select
        id="evm-default-rpc-select"
        class="ui-select"
        bind:value={selectedDefaultRpc}
        onchange={onDefaultRpcChange}
      >
        <option value="">{$t('settings.defaultRpcCuratedDefaults')}</option>
        {#each defaultRpcOptions as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </div>
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
      class="ui-input"
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

  .evm-extras-select-inline {
    width: auto;
    min-width: 160px;
    max-width: 220px;
    flex: 0 1 auto;
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

  .evm-extras-btn {
    min-height: 40px;
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
