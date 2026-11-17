<script lang="ts">
  import { t } from 'svelte-i18n';
  import Modal from '../ui/Modal.svelte';
  import { getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import type { SupportedChainId } from '../../lib/wallet/chains';
  import { getEvmErc20Balance } from '../../lib/governance/squad-tracked-tokens';
  import {
    buildCatalogSearchEntries,
    catalogEntryToRow,
    customTokenId,
    loadWatchedErc20Rows,
    mergeWatchedRows,
    saveWatchedErc20Rows,
    type CatalogSearchEntry,
    type WatchedErc20Row,
  } from '../../lib/wallet/watched-tokens';

  interface Props {
    open?: boolean;
    onClose: () => void;
    accountNpub?: string | null;
    ownerAddress?: string | null;
    enabledChainIds?: SupportedChainId[];
    onSaved: () => void;
  }

  let {
    open = false,
    onClose,
    accountNpub = null,
    ownerAddress = null,
    enabledChainIds = [],
    onSaved,
  }: Props = $props();

  const titleId = 'wallet-import-tokens-title';

  let tracked: WatchedErc20Row[] = $state([]);
  let customNetwork = $state<SupportedChainId>('arbitrum');
  let customAddress = $state('');
  let scanning = $state(false);
  let reading = $state(false);
  let status: string | null = $state(null);
  let lastOpened = $state(false);

  const suggestions = $derived(
    buildCatalogSearchEntries().filter((entry) => enabledChainIds.includes(entry.network)),
  );

  const chainChoices = $derived(
    enabledChainIds.length > 0 ? enabledChainIds : (['arbitrum'] as SupportedChainId[]),
  );

  function reload() {
    tracked = accountNpub ? loadWatchedErc20Rows(accountNpub) : [];
  }

  $effect(() => {
    if (!open) {
      lastOpened = false;
      return;
    }
    if (lastOpened) return;
    lastOpened = true;
    status = null;
    customAddress = '';
    customNetwork = chainChoices.includes(customNetwork) ? customNetwork : chainChoices[0];
    reload();
  });

  function rowKey(network: string, address: string): string {
    return `${network}:${address.trim().toLowerCase()}`;
  }

  function alreadyTracked(network: string, address: string): boolean {
    const key = rowKey(network, address);
    return tracked.some((row) => rowKey(row.network, row.address) === key);
  }

  function persist(next: WatchedErc20Row[]) {
    if (!accountNpub) return;
    saveWatchedErc20Rows(accountNpub, next);
    reload();
    onSaved();
  }

  function addSuggestion(entry: CatalogSearchEntry) {
    if (!accountNpub || scanning || alreadyTracked(entry.network, entry.address)) return;
    persist([...tracked, catalogEntryToRow(entry)]);
  }

  function removeRow(row: WatchedErc20Row) {
    if (scanning) return;
    persist(tracked.filter((item) => item.id !== row.id));
  }

  function isHexAddress(value: string): boolean {
    const body = value.trim().startsWith('0x') ? value.trim().slice(2) : value.trim();
    return body.length === 40 && /^[0-9a-fA-F]+$/.test(body);
  }

  async function scanHoldings() {
    if (!accountNpub || !ownerAddress || scanning) return;
    scanning = true;
    status = null;
    const discovered: WatchedErc20Row[] = [];
    try {
      const baseline = loadWatchedErc20Rows(accountNpub);
      for (const entry of suggestions) {
        if (baseline.some((row) => rowKey(row.network, row.address) === rowKey(entry.network, entry.address))) {
          continue;
        }
        if (discovered.some((row) => rowKey(row.network, row.address) === rowKey(entry.network, entry.address))) {
          continue;
        }
        const result = await getEvmErc20Balance(entry.network, entry.address, ownerAddress);
        if (!result.ok) continue;
        let raw = 0n;
        try {
          raw = BigInt(result.balance.balanceRaw);
        } catch {
          continue;
        }
        if (raw <= 0n) continue;
        discovered.push(catalogEntryToRow(entry));
      }
      if (discovered.length > 0) {
        const merged = mergeWatchedRows(loadWatchedErc20Rows(accountNpub), discovered);
        saveWatchedErc20Rows(accountNpub, merged);
        reload();
        onSaved();
      }
      status =
        discovered.length > 0
          ? $t('wallet.scanAdded', { values: { count: discovered.length } })
          : $t('wallet.scanNone');
    } finally {
      scanning = false;
    }
  }

  async function addByAddress() {
    if (!accountNpub || !ownerAddress || reading || scanning || !isHexAddress(customAddress)) return;
    const network = customNetwork;
    const address = customAddress.trim();
    reading = true;
    status = null;
    try {
      const result = await getEvmErc20Balance(network, address, ownerAddress);
      if (!result.ok) {
        status = $t('wallet.couldNotReadToken');
        return;
      }
      const symbol = result.balance.symbol.trim().toUpperCase();
      const decimals = result.balance.decimals;
      if (!symbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
        status = $t('wallet.couldNotReadToken');
        return;
      }
      if (alreadyTracked(network, address)) {
        customAddress = '';
        return;
      }
      const row: WatchedErc20Row = {
        id: customTokenId(network, address),
        network,
        symbol,
        address,
        decimals,
        source: 'custom',
      };
      persist([...tracked, row]);
      customAddress = '';
    } finally {
      reading = false;
    }
  }
</script>

{#if open}
  <Modal {titleId} {onClose} dismissible={true}>
    <div class="w-import-head">
      <h2 id={titleId}>{$t('wallet.addTokens')}</h2>
      <button type="button" class="w-import-close" aria-label={$t('wallet.close')} onclick={onClose}>×</button>
    </div>

    {#if !accountNpub}
      <p class="w-import-status" role="status">{$t('wallet.signInToManageTokens')}</p>
    {:else}
      <div class="w-import-block">
        <div class="w-import-block-head">
          <h3>{$t('wallet.suggestedTokens')}</h3>
          <button
            type="button"
            class="w-import-btn-secondary"
            disabled={!ownerAddress || scanning || suggestions.length === 0}
            onclick={() => void scanHoldings()}
          >
            {scanning ? $t('wallet.scanningTokens') : $t('wallet.scanTokenHoldings')}
          </button>
        </div>
        {#if suggestions.length === 0}
          <p class="w-import-status">{$t('wallet.noSuggestedTokens')}</p>
        {:else}
          <ul class="w-import-list">
            {#each suggestions as entry (entry.id)}
              <li class="w-import-row">
                <span class="w-import-sym">{entry.symbol}</span>
                <span class="w-import-meta">{getWalletNetworkDisplayName(entry.network)}</span>
                <button
                  type="button"
                  class="w-import-btn-secondary"
                  disabled={scanning || alreadyTracked(entry.network, entry.address)}
                  onclick={() => addSuggestion(entry)}
                >
                  {$t('wallet.addToken')}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      {#if status}
        <p class="w-import-status" role="status">{status}</p>
      {/if}

      <div class="w-import-block">
        <h3>{$t('wallet.tokenAddress')}</h3>
        <div class="w-import-address">
          <select class="ui-select" bind:value={customNetwork} aria-label={$t('wallet.networksMenu')} disabled={reading}>
            {#each chainChoices as chainId (chainId)}
              <option value={chainId}>{getWalletNetworkDisplayName(chainId)}</option>
            {/each}
          </select>
          <input
            class="ui-input"
            type="text"
            placeholder={$t('wallet.tokenContractPlaceholder')}
            bind:value={customAddress}
            autocomplete="off"
            spellcheck="false"
            disabled={reading}
            aria-label={$t('wallet.tokenContractLabel')}
          />
          <button
            type="button"
            class="w-import-btn-primary"
            disabled={!ownerAddress || reading || scanning || !isHexAddress(customAddress)}
            onclick={() => void addByAddress()}
          >
            {$t('wallet.addToken')}
          </button>
        </div>
      </div>

      <div class="w-import-block">
        <h3>{$t('wallet.trackedTokens')}</h3>
        {#if tracked.length === 0}
          <p class="w-import-status">{$t('wallet.noMatchingTokens')}</p>
        {:else}
          <ul class="w-import-list">
            {#each tracked as row (row.id)}
              <li class="w-import-row">
                <span class="w-import-sym">{row.symbol}</span>
                <span class="w-import-meta">{getWalletNetworkDisplayName(row.network)}</span>
                <button type="button" class="w-import-btn-secondary" disabled={scanning} onclick={() => removeRow(row)}>
                  {$t('wallet.removeToken')}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </Modal>
{/if}

<style>
  .w-import-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }

  .w-import-head h2,
  .w-import-block h3 {
    margin: 0;
    color: var(--text-primary);
  }

  .w-import-head h2 {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .w-import-block h3 {
    font-size: 0.9375rem;
    font-weight: 600;
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

  .w-import-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 16px;
  }

  .w-import-block-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .w-import-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 220px;
    overflow: auto;
  }

  .w-import-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .w-import-sym {
    font-weight: 600;
    color: var(--text-primary);
  }

  .w-import-meta {
    flex: 1;
    min-width: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .w-import-address {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .w-import-address .ui-select,
  .w-import-address .ui-input {
    flex: 1 1 140px;
  }

  .w-import-status {
    margin: 8px 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .w-import-btn-primary,
  .w-import-btn-secondary {
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 0.8125rem;
    font-family: inherit;
    cursor: pointer;
  }

  .w-import-btn-primary {
    border: none;
    background: var(--brand);
    color: var(--on-brand);
    font-weight: 600;
  }

  .w-import-btn-secondary {
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-primary);
  }

  .w-import-btn-primary:disabled,
  .w-import-btn-secondary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
