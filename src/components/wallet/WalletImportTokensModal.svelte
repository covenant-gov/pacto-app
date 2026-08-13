<script lang="ts">
  import { t } from 'svelte-i18n';
  import Modal from '../ui/Modal.svelte';
  import type { SupportedChainId } from '../../lib/wallet/chains';
  import { WALLET_ASSETS_CHAIN_IDS, getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import {
    buildCatalogSearchEntries,
    catalogEntryToRow,
    customTokenId,
    loadWatchedErc20Rows,
    saveWatchedErc20Rows,
    type CatalogSearchEntry,
    type WatchedErc20Row,
  } from '../../lib/wallet/watched-tokens';
  import { appConfig } from '../../stores/app-config';

  export let open = false;
  export let onClose: () => void;
  /** Mirrors WalletBar network filter: limits Search results and Custom default chain. */
  export let networkScope: 'all' | SupportedChainId = 'all';
  export let accountNpub: string | null = null;
  export let onSaved: () => void;

  const titleId = 'wallet-import-tokens-title';
  const descId = 'wallet-import-tokens-desc';

  let tab: 'search' | 'custom' = 'search';
  let searchQuery = '';
  let selectedCatalogIds = new Set<string>();

  let customNetwork: SupportedChainId = 'mainnet';
  let customAddress = '';
  let customSymbol = '';
  let customDecimalsStr = '18';

  let lastOpened = false;

  $: customTokenSymbolMaxLength = $appConfig.customTokenSymbolMaxLength;

  $: catalog = buildCatalogSearchEntries();

  $: filteredCatalog = catalog.filter((e) => {
    if (networkScope !== 'all' && e.network !== networkScope) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return e.searchText.includes(q) || e.symbol.toLowerCase().includes(q);
  }) as CatalogSearchEntry[];

  $: if (open && !lastOpened) {
    lastOpened = true;
    if (accountNpub) {
      const rows = loadWatchedErc20Rows(accountNpub);
      selectedCatalogIds = new Set(rows.filter((r) => r.source === 'catalog').map((r) => r.id));
    }
    tab = 'search';
    searchQuery = '';
    if (networkScope !== 'all') customNetwork = networkScope;
  }
  $: if (!open) lastOpened = false;

  function isHexAddress(s: string): boolean {
    const t = s.trim();
    const h = t.startsWith('0x') ? t.slice(2) : t;
    return h.length === 40 && /^[0-9a-fA-F]+$/.test(h);
  }

  function toggleCatalog(entry: CatalogSearchEntry) {
    const next = new Set(selectedCatalogIds);
    if (next.has(entry.id)) next.delete(entry.id);
    else next.add(entry.id);
    selectedCatalogIds = next;
  }

  function saveCatalogSelection() {
    if (!accountNpub) return;
    const rows = loadWatchedErc20Rows(accountNpub);
    const customs = rows.filter((r) => r.source === 'custom');
    const picked = catalog
      .filter((e) => selectedCatalogIds.has(e.id))
      .map(catalogEntryToRow);
    saveWatchedErc20Rows(accountNpub, [...customs, ...picked]);
    onSaved();
    onClose();
  }

  function saveCustomToken() {
    if (!accountNpub) return;
    const sym = customSymbol.trim().toUpperCase();
    const dec = Number.parseInt(customDecimalsStr, 10);
    if (!sym || sym.length > customTokenSymbolMaxLength || !/^[A-Z0-9]+$/.test(sym)) return;
    if (!isHexAddress(customAddress)) return;
    if (!Number.isInteger(dec) || dec < 0 || dec > 36) return;
    const id = customTokenId(customNetwork, customAddress);
    const row: WatchedErc20Row = {
      id,
      network: customNetwork,
      symbol: sym,
      address: customAddress.trim(),
      decimals: dec,
      source: 'custom',
    };
    const rows = loadWatchedErc20Rows(accountNpub);
    const merged = [...rows.filter((r) => r.id !== id), row];
    saveWatchedErc20Rows(accountNpub, merged);
    customAddress = '';
    customSymbol = '';
    customDecimalsStr = '18';
    onSaved();
    onClose();
  }

  $: customDecimalsValid = (() => {
    const d = Number.parseInt(customDecimalsStr, 10);
    return Number.isInteger(d) && d >= 0 && d <= 36;
  })();

  $: customSymbolValid = customSymbol.trim().length > 0 && customSymbol.trim().length <= customTokenSymbolMaxLength && /^[A-Z0-9]+$/.test(customSymbol.trim().toUpperCase());

  $: canSaveCustom =
    accountNpub != null &&
    isHexAddress(customAddress) &&
    customSymbolValid &&
    customDecimalsValid;
</script>

{#if open}
  <Modal {titleId} descriptionId={descId} {onClose} dismissible={true}>
    <div class="w-import-head">
      <h2 id={titleId}>{$t('wallet.importTokensTitle')}</h2>
      <button type="button" class="w-import-close" aria-label={$t('wallet.close')} on:click={onClose}>×</button>
    </div>
    <p id={descId} class="w-import-desc">
      {$t('wallet.importTokensDesc')}
    </p>

    {#if !accountNpub}
      <p class="w-import-warn" role="status">{$t('wallet.signInToManageTokens')}</p>
    {:else}
      <div class="w-import-tabs" role="tablist" aria-label={$t('wallet.importMode')}>
        <button
          type="button"
          role="tab"
          class="w-import-tab"
          aria-selected={tab === 'search'}
          class:w-import-tab-active={tab === 'search'}
          on:click={() => (tab = 'search')}>{$t('wallet.searchTab')}</button
        >
        <button
          type="button"
          role="tab"
          class="w-import-tab"
          aria-selected={tab === 'custom'}
          class:w-import-tab-active={tab === 'custom'}
          on:click={() => (tab = 'custom')}>{$t('wallet.customTokenTab')}</button
        >
      </div>

      {#if tab === 'search'}
        <label class="w-import-label">
          <span class="w-import-label-text">{$t('wallet.searchLabel')}</span>
          <input
            class="w-import-input"
            type="search"
            placeholder={$t('wallet.searchPlaceholder')}
            bind:value={searchQuery}
            autocomplete="off"
          />
        </label>
        <ul class="w-import-list" role="listbox" aria-label={$t('wallet.catalogTokens')}>
          {#each filteredCatalog as entry (entry.id)}
            <li class="w-import-row">
              <label class="w-import-check-label">
                <input
                  type="checkbox"
                  checked={selectedCatalogIds.has(entry.id)}
                  on:change={() => toggleCatalog(entry)}
                />
                <span class="w-import-row-main">
                  <span class="w-import-sym">{entry.symbol}</span>
                  <span class="w-import-meta">{getWalletNetworkDisplayName(entry.network)}</span>
                </span>
              </label>
            </li>
          {:else}
            <li class="w-import-empty">{$t('wallet.noMatchingTokens')}</li>
          {/each}
        </ul>
        <div class="w-import-actions">
          <button type="button" class="w-import-btn-secondary" on:click={onClose}>{$t('wallet.cancel')}</button>
          <button type="button" class="w-import-btn-primary" on:click={saveCatalogSelection}
            >{$t('wallet.save')}</button
          >
        </div>
      {:else}
        <label class="w-import-label">
          <span class="w-import-label-text">{$t('wallet.networkLabel')}</span>
          <select class="w-import-select" bind:value={customNetwork} disabled={networkScope !== 'all'}>
            {#each WALLET_ASSETS_CHAIN_IDS as cid (cid)}
              <option value={cid as SupportedChainId}>{getWalletNetworkDisplayName(cid as SupportedChainId)}</option>
            {/each}
          </select>
        </label>
        <label class="w-import-label">
          <span class="w-import-label-text">{$t('wallet.tokenContractLabel')}</span>
          <input
            class="w-import-input"
            type="text"
            placeholder={$t('wallet.tokenContractPlaceholder')}
            bind:value={customAddress}
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        <label class="w-import-label">
          <span class="w-import-label-text">{$t('wallet.symbolLabel')}</span>
          <input
            class="w-import-input"
            type="text"
            placeholder={$t('wallet.symbolPlaceholder')}
            bind:value={customSymbol}
            maxlength={customTokenSymbolMaxLength}
            autocomplete="off"
          />
        </label>
        <label class="w-import-label">
          <span class="w-import-label-text">{$t('wallet.decimalsLabel')}</span>
          <input
            class="w-import-input"
            type="text"
            inputmode="numeric"
            bind:value={customDecimalsStr}
            autocomplete="off"
          />
        </label>
        <p class="w-import-hint">
          {$t('wallet.tokenSecurityHint')}
        </p>
        <div class="w-import-actions">
          <button type="button" class="w-import-btn-secondary" on:click={onClose}>{$t('wallet.cancel')}</button>
          <button
            type="button"
            class="w-import-btn-primary"
            disabled={!canSaveCustom}
            on:click={saveCustomToken}>{$t('wallet.importToken')}</button
          >
        </div>
      {/if}
    {/if}
  </Modal>
{/if}

<style>
  .w-import-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }

  .w-import-head h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .w-import-close {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
  }

  .w-import-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .w-import-desc {
    margin: 0 0 16px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .w-import-warn {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .w-import-tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 14px;
  }

  .w-import-tab {
    flex: 1;
    padding: 10px 8px;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--text-muted);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
  }

  .w-import-tab-active {
    color: var(--text-primary);
    border-bottom-color: var(--text-primary);
  }

  .w-import-label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0 0 12px;
  }

  .w-import-label-text {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .w-import-input,
  .w-import-select {
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-hover);
    color: var(--text-primary);
    font-size: 0.875rem;
    font-family: inherit;
    box-sizing: border-box;
    width: 100%;
  }

  .w-import-list {
    margin: 0 0 16px;
    padding: 0;
    list-style: none;
    max-height: min(240px, 40vh);
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .w-import-row {
    border-bottom: 1px solid var(--border);
  }

  .w-import-row:last-child {
    border-bottom: none;
  }

  .w-import-check-label {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    cursor: pointer;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .w-import-check-label:hover {
    background: var(--bg-hover);
  }

  .w-import-row-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .w-import-sym {
    font-weight: 600;
  }

  .w-import-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .w-import-empty {
    padding: 16px;
    font-size: 0.8125rem;
    color: var(--text-muted);
    list-style: none;
  }

  .w-import-hint {
    margin: 0 0 16px;
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .w-import-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: flex-end;
  }

  .w-import-btn-primary,
  .w-import-btn-secondary {
    padding: 10px 18px;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-family: inherit;
  }

  .w-import-btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .w-import-btn-primary {
    background: var(--brand);
    color: var(--on-brand);
  }

  .w-import-btn-secondary {
    background: var(--border);
    color: var(--text-primary);
  }
</style>
