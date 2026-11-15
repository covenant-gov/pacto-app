<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  const tFn = get(t);
  import {
    bindingsByAccountId,
    listEvmAccountSquadBindings,
    type EvmAccountSquadBinding,
  } from '../../lib/squad/evm-account-squad-bindings';
  import { openSquadGovernance } from '../../lib/navigation/open-squad-governance';
  import { squads } from '../../stores/app';
  import type { Squad } from '../../stores/squads';
  import {
    isSeedDerivedEvmAccount,
    squadEvmAccounts,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import { copyTextToClipboard } from '../../lib/wallet/clipboard-copy';
  import { showToast } from '../../stores/toast';
  import EvmAccountKeyExportModal from './EvmAccountKeyExportModal.svelte';
  import EditIconButton from '../ui/EditIconButton.svelte';
  import MoreActionsMenu from '../ui/MoreActionsMenu.svelte';
  import { shortEvmAddress as shortAddr } from '../../lib/governance/hats-tree-annotations';

  interface Props {
    accountNpub?: string | null;
    evmAddress?: string | null;
    embeddedInSettings?: boolean;
    showSquadList?: boolean;
    evmAccountList?: EvmAccountRow[];
    accountsLoading?: boolean;
    onSetActiveAccount?: (id: string) => void;
    onEditAccount?: (acc: EvmAccountRow) => void;
    onAddSquad?: () => void;
  }

  let {
    accountNpub = null,
    evmAddress = null,
    embeddedInSettings = false,
    showSquadList = true,
    evmAccountList = [],
    accountsLoading = false,
    onSetActiveAccount = () => {},
    onEditAccount = () => {},
    onAddSquad = () => {},
  }: Props = $props();

  let bindings: EvmAccountSquadBinding[] = $state([]);
  let bindingsLoading = $state(false);
  let exportAccount: EvmAccountRow | null = $state(null);
  let exportModalOpen = $state(false);

  let squadList = $derived(squadEvmAccounts(evmAccountList));
  let bindingMap = $derived(bindingsByAccountId(bindings));
  let displayRows = $derived(showSquadList ? squadList : []);
  let derivedRows = $derived(displayRows.filter(isSeedDerivedEvmAccount));
  let importedRows = $derived(displayRows.filter((row) => !isSeedDerivedEvmAccount(row)));

  $effect(() => {
    void accountNpub;
    void evmAccountList;
    void loadBindings();
  });

  async function loadBindings() {
    if (!accountNpub) {
      bindings = [];
      return;
    }
    bindingsLoading = true;
    try {
      bindings = await listEvmAccountSquadBindings();
    } catch (e) {
      console.error('list_evm_account_squad_bindings failed:', e);
      bindings = [];
    } finally {
      bindingsLoading = false;
    }
  }

  function shortParentId(id: string): string {
    const t = id.trim();
    if (t.length <= 20) return t;
    return `${t.slice(0, 10)}…${t.slice(-8)}`;
  }

  async function copyAddress(address: string) {
    const t = address.trim();
    if (!t) return;
    const ok = await copyTextToClipboard(t);
    showToast(ok ? tFn('wallet.copyAddress') : tFn('wallet.couldNotCopyHash'));
  }

  function squadForParentId(parentId: string): Squad | undefined {
    const pid = parentId.trim();
    return $squads.find(
      (s) => s.id === pid || s.channels?.some((c) => c.groupId.trim() === pid),
    );
  }

  function squadName(parentId: string): string {
    return squadForParentId(parentId)?.name?.trim() || tFn('wallet.unnamedSquad');
  }

  function squadBindingsFor(acc: EvmAccountRow): EvmAccountSquadBinding[] {
    return bindingMap.get(acc.id) ?? [];
  }

  function accountName(acc: EvmAccountRow): string {
    return acc.label?.trim() || shortAddr(acc.address);
  }

  function openExportModal(acc: EvmAccountRow) {
    exportAccount = acc;
    exportModalOpen = true;
  }

  function closeExportModal() {
    exportModalOpen = false;
    exportAccount = null;
  }
</script>

<section
  class="evm-section wallet-view-section"
  aria-labelledby={embeddedInSettings ? 'wallet-squad-evm-heading' : 'wallet-evm-accounts-heading'}
>
  {#if showSquadList}
  <div class="wallet-view-section-head">
    <h2
      id={embeddedInSettings ? 'wallet-squad-evm-heading' : 'wallet-evm-accounts-heading'}
      class="wallet-view-h2"
    >
      {embeddedInSettings ? $t('wallet.squadEvmAccountsTitle') : $t('wallet.evmAccountsTitle')}
    </h2>
    <div class="wallet-view-account-actions">
      <button
        type="button"
        class="wallet-view-btn wallet-view-btn-secondary"
        disabled={!evmAddress}
        onclick={onAddSquad}
      >
        {embeddedInSettings ? $t('wallet.addSquadAccount') : $t('wallet.addNewAccount')}
      </button>
    </div>
  </div>

  {#if accountsLoading && displayRows.length === 0}
    <p class="wallet-view-empty">{$t('wallet.loadingAccounts')}</p>
  {:else if displayRows.length === 0}
    <p class="wallet-view-empty">
      {embeddedInSettings
        ? $t('wallet.noSquadEvmAccounts')
        : $t('wallet.noEvmAccounts')}
    </p>
  {:else}
    {#snippet accountRow(acc: EvmAccountRow)}
      {@const linkedSquads = squadBindingsFor(acc)}
      {@const name = accountName(acc)}
      <li
        class="wallet-view-account-row evm-account-row"
        class:wallet-view-account-active={!embeddedInSettings && acc.isActive}
      >
        {#if embeddedInSettings}
          <div class="evm-account-primary">
            <p class="evm-account-name">{name}</p>
            <button
              type="button"
              class="evm-account-address-pill"
              disabled={accountsLoading || !acc.address?.trim()}
              aria-label={$t('wallet.copyAddressToClipboard')}
              title={acc.address}
              onclick={() => void copyAddress(acc.address)}
            >
              <code class="evm-account-address-short">{shortAddr(acc.address)}</code>
              <svg
                class="evm-account-copy-icon"
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
            <MoreActionsMenu
              disabled={accountsLoading}
              ariaLabel={$t('wallet.accountActionsMenu')}
              items={[
                {
                  id: 'export-key',
                  label: $t('wallet.exportKey'),
                  onSelect: () => openExportModal(acc),
                },
                {
                  id: 'edit-name',
                  label: $t('wallet.editAccountName'),
                  onSelect: () => onEditAccount(acc),
                },
              ]}
            />
          </div>

          <div class="evm-account-squad-block">
            <span class="evm-account-squad-heading">{$t('wallet.squadsLabel')}</span>
            {#if bindingsLoading}
              <span class="evm-account-squad-muted">{$t('wallet.loading')}</span>
            {:else if linkedSquads.length === 0}
              <span class="evm-account-squad-muted">{$t('wallet.noneAssigned')}</span>
            {:else}
              <ul class="evm-account-squad-list">
                {#each linkedSquads as link (link.parentId)}
                  <li>
                    <button
                      type="button"
                      class="evm-account-squad-link"
                      onclick={() => openSquadGovernance(link.parentId)}
                    >
                      <span class="evm-account-squad-name">{squadName(link.parentId)}</span>
                      <span class="evm-account-squad-id" title={link.parentId}>{shortParentId(link.parentId)}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {:else}
          <label class="wallet-view-account-select">
            <input
              type="radio"
              name="active_evm_account"
              checked={acc.isActive}
              disabled={accountsLoading}
              onchange={() => onSetActiveAccount(acc.id)}
            />
            <span class="wallet-view-account-meta">
              <span class="wallet-view-account-name">{name}</span>
            </span>
          </label>

          <button
            type="button"
            class="wallet-view-account-addr-btn"
            disabled={accountsLoading || !acc.address?.trim()}
            title={acc.address}
            aria-label={$t('wallet.copyAddressToClipboard')}
            onclick={(e) => { e.stopPropagation(); void copyAddress(acc.address); }}
          >
            <code class="wallet-view-account-addr">{shortAddr(acc.address)}</code>
          </button>
          <div class="wallet-view-account-tools">
            {#if acc.isActive}
              <span class="wallet-view-account-badge">{$t('wallet.signerBadge')}</span>
            {/if}
            {#if acc.isDefaultShared}
              <span class="wallet-view-account-badge">{$t('wallet.receiverBadge')}</span>
            {/if}
            <EditIconButton
              disabled={accountsLoading}
              ariaLabel={$t('wallet.editAccountName')}
              title={$t('wallet.editDisplayName')}
              className="evm-account-edit-btn"
              onclick={() => onEditAccount(acc)}
            />
          </div>
        {/if}
      </li>
    {/snippet}

    {#if derivedRows.length > 0}
      <ul class="wallet-view-account-list evm-accounts-list">
        {#each derivedRows as acc (acc.id)}
          {@render accountRow(acc)}
        {/each}
      </ul>
    {/if}

    {#if importedRows.length > 0}
      <h3 class="evm-imported-heading">{$t('wallet.importedAccountsSection')}</h3>
      <ul class="wallet-view-account-list evm-accounts-list evm-imported-list">
        {#each importedRows as acc (acc.id)}
          {@render accountRow(acc)}
        {/each}
      </ul>
    {/if}
  {/if}
  {/if}
</section>

<EvmAccountKeyExportModal open={exportModalOpen} account={exportAccount} onClose={closeExportModal} />

<style>
  .evm-section :global(.wallet-view-section-head) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }

  .evm-section :global(.wallet-view-h2) {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .evm-section :global(.wallet-view-empty) {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .evm-section :global(.wallet-view-account-actions) {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .evm-section :global(.wallet-view-btn) {
    padding: 8px 16px;
    border: none;
    border-radius: 8px;
    background: var(--brand);
    color: var(--on-brand);
    font-size: 0.875rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  .evm-section :global(.wallet-view-btn-secondary) {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .evm-section :global(.wallet-view-account-list) {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .evm-section :global(.wallet-view-account-row) {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding: 12px 14px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  .evm-imported-heading {
    margin: 20px 0 10px;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
  }

  .evm-imported-list {
    margin-top: 0;
  }

  .evm-section :global(.wallet-view-account-meta) {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
  }

  .evm-section :global(.wallet-view-account-badge) {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--brand);
    text-transform: uppercase;
  }

  .evm-section :global(.wallet-view-account-name) {
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .evm-section :global(.wallet-view-account-addr) {
    font-size: 0.8125rem;
    color: var(--text-primary);
    word-break: break-all;
  }

  .evm-section :global(.wallet-view-account-tools) {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .evm-section :global(.evm-account-edit-btn),
  .evm-section :global(.wallet-view-account-copy-icon-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-hover);
    color: var(--text-primary);
    cursor: pointer;
    transition: border-color 0.2s;
  }

  .evm-section :global(.evm-account-edit-btn) {
    width: 2rem;
    height: 2rem;
    min-width: unset;
    padding: 0;
  }

  .evm-section :global(.wallet-view-account-copy-icon-btn) {
    width: 2rem;
    height: 2rem;
    padding: 0;
  }

  .evm-section :global(.evm-account-edit-btn:hover:not(:disabled)) {
    border-color: var(--brand);
  }

  .evm-accounts-list {
    gap: 12px;
  }

  .evm-account-row {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .evm-account-primary {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .evm-account-name {
    margin: 0;
    flex: 0 1 auto;
    min-width: 0;
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.3;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .evm-account-address-pill {
    display: inline-flex;
    flex: 0 1 auto;
    align-items: center;
    gap: 8px;
    min-width: 0;
    margin: 0;
    margin-right: auto;
    padding: 6px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    background: var(--bg-elevated);
    color: var(--text-secondary);
    cursor: pointer;
    font: inherit;
  }

  .evm-account-address-pill:hover:not(:disabled) {
    border-color: var(--border);
    color: var(--text-primary);
  }

  .evm-account-address-pill:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
  }

  .evm-account-address-pill:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .evm-account-address-short {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.8125rem;
  }

  .evm-account-copy-icon {
    flex-shrink: 0;
  }

  .wallet-view-account-addr-btn {
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    text-align: left;
  }

  .wallet-view-account-addr-btn:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
    border-radius: 4px;
  }

  .evm-account-squad-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
  }

  .evm-account-squad-heading {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .evm-account-squad-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .evm-account-squad-muted {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .evm-account-squad-link {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    outline: none;
  }

  .evm-account-squad-link:hover .evm-account-squad-name {
    text-decoration: underline;
    color: var(--brand);
  }

  .evm-account-squad-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .evm-account-squad-id {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: ui-monospace, 'Courier New', monospace;
  }
</style>
