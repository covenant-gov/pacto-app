<script lang="ts">
  import { onMount } from 'svelte';
  import {
    bindingsByAccountId,
    listEvmAccountSquadBindings,
    type EvmAccountSquadBinding,
  } from '../../lib/squad/evm-account-squad-bindings';
  import { openSquadDashboard } from '../../lib/navigation/open-squad-dashboard';
  import { squads } from '../../stores/app';
  import type { Squad } from '../../stores/squads';
  import {
    evmAccountSchemeLabel,
    squadEvmAccounts,
    advancedEvmAccounts,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import { copyTextToClipboard } from '../../lib/wallet/clipboard-copy';
  import { showToast } from '../../stores/toast';
  import EvmAccountKeyExportModal from './EvmAccountKeyExportModal.svelte';
  import { settingsSectionCollapsed } from '../../lib/settings/settings-section-collapse';

  export let accountNpub: string | null = null;
  export let evmAddress: string | null = null;
  export let embeddedInSettings = false;
  export let evmAccountList: EvmAccountRow[] = [];
  export let accountsLoading = false;
  export let onSetActiveAccount: (id: string) => void = () => {};
  export let onSetActiveAdvancedAccount: (id: string) => void = () => {};
  export let onEditAccount: (acc: EvmAccountRow) => void = () => {};
  export let onAddSquad: () => void = () => {};
  export let onAddAdvanced: () => void = () => {};
  export let onImportKey: () => void = () => {};

  let bindings: EvmAccountSquadBinding[] = [];
  let bindingsLoading = false;
  let exportAccount: EvmAccountRow | null = null;
  let exportModalOpen = false;

  $: squadList = squadEvmAccounts(evmAccountList);
  $: advancedList = advancedEvmAccounts(evmAccountList);
  $: bindingMap = bindingsByAccountId(bindings);
  $: displayRows = embeddedInSettings ? squadList : [...squadList, ...advancedList];

  $: accountNpub, evmAccountList, void loadBindings();

  $: if (embeddedInSettings && ($settingsSectionCollapsed['settings-evm'] ?? true) && exportModalOpen) {
    closeExportModal();
  }

  onMount(() => {
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

  function shortAddr(a: string): string {
    const t = a.trim();
    if (t.length < 18) return t;
    return `${t.slice(0, 10)}…${t.slice(-8)}`;
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
    showToast(ok ? 'Address copied' : 'Could not copy address');
  }

  function squadForParentId(parentId: string): Squad | undefined {
    const pid = parentId.trim();
    return $squads.find(
      (s) => s.id === pid || s.channels?.some((c) => c.groupId.trim() === pid),
    );
  }

  function squadName(parentId: string): string {
    return squadForParentId(parentId)?.name?.trim() || 'Unnamed squad';
  }

  function squadBindingsFor(acc: EvmAccountRow): EvmAccountSquadBinding[] {
    return bindingMap.get(acc.id) ?? [];
  }

  function isAdvancedRow(acc: EvmAccountRow): boolean {
    return acc.purpose === 'advanced';
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
  <div class="wallet-view-section-head">
    <h2
      id={embeddedInSettings ? 'wallet-squad-evm-heading' : 'wallet-evm-accounts-heading'}
      class="wallet-view-h2"
    >
      {embeddedInSettings ? 'Squad EVM accounts' : 'EVM accounts'}
    </h2>
    <div class="wallet-view-account-actions">
      <button
        type="button"
        class="wallet-view-btn wallet-view-btn-secondary"
        disabled={!evmAddress}
        on:click={onAddSquad}
      >
        {embeddedInSettings ? 'Add squad account' : 'Add new account'}
      </button>
      {#if !embeddedInSettings}
        <button
          type="button"
          class="wallet-view-btn wallet-view-btn-secondary"
          disabled={!evmAddress}
          on:click={onAddAdvanced}
        >
          Add advanced account
        </button>
        <button
          type="button"
          class="wallet-view-btn wallet-view-btn-secondary"
          disabled={!evmAddress}
          on:click={onImportKey}
        >
          Import private key
        </button>
      {/if}
    </div>
  </div>

  <p class="wallet-view-hint">
    {#if embeddedInSettings}
      Derived squad keys are assigned per squad for roster, treasury, and governance. Set your default signer and receiver
      in <strong>Default EVM account</strong> above.
    {:else}
      Derived squad keys power DM wallet, roster shares, treasury deploy, and governance. Advanced imported keys are for
      experimental contract calls only.
    {/if}
  </p>

  {#if accountsLoading && displayRows.length === 0}
    <p class="wallet-view-empty">Loading accounts…</p>
  {:else if displayRows.length === 0}
    <p class="wallet-view-empty">
      {embeddedInSettings
        ? 'No squad EVM accounts yet. Unlock your wallet or add one from your recovery phrase.'
        : 'No EVM accounts yet. Unlock your wallet or add one from your recovery phrase.'}
    </p>
  {:else}
    <ul class="wallet-view-account-list evm-accounts-list">
      {#each displayRows as acc (acc.id)}
        {@const linkedSquads = squadBindingsFor(acc)}
        <li
          class="wallet-view-account-row evm-account-row"
          class:wallet-view-account-active={!embeddedInSettings && (acc.isActive || acc.isActiveAdvanced)}
        >
          {#if embeddedInSettings}
            <div class="evm-account-primary">
              <code class="wallet-view-account-addr evm-account-addr-full" title={acc.address}>{acc.address}</code>
              <div class="evm-account-meta-row">
                <div class="evm-account-badges">
                  <span class="wallet-view-account-scheme">{evmAccountSchemeLabel(acc.scheme)}</span>
                  {#if acc.hdIndex != null}
                    <span class="wallet-view-account-idx">#{acc.hdIndex}</span>
                  {/if}
                  {#if acc.label?.trim()}
                    <span class="wallet-view-account-name">{acc.label.trim()}</span>
                  {/if}
                </div>
                <div class="wallet-view-account-tools evm-account-tools-inline">
                  <button
                    type="button"
                    class="wallet-view-btn-export-key"
                    disabled={accountsLoading}
                    on:click={() => openExportModal(acc)}
                  >
                    Export key
                  </button>
                  <button
                    type="button"
                    class="wallet-view-account-more"
                    disabled={accountsLoading}
                    aria-label="Edit account name"
                    title="Edit display name"
                    on:click={() => onEditAccount(acc)}
                  >
                    <svg
                      class="wallet-view-account-edit-svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.75"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="wallet-view-account-copy-icon-btn"
                    disabled={accountsLoading || !acc.address?.trim()}
                    aria-label="Copy address to clipboard"
                    title="Copy address"
                    on:click|stopPropagation={() => copyAddress(acc.address)}
                  >
                    <svg
                      class="wallet-view-account-copy-svg"
                      width="18"
                      height="18"
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
            </div>

            <div class="evm-account-squad-block">
              <span class="evm-account-squad-heading">Squads</span>
              {#if bindingsLoading}
                <span class="evm-account-squad-muted">Loading…</span>
              {:else if linkedSquads.length === 0}
                <span class="evm-account-squad-muted">None assigned</span>
              {:else}
                <ul class="evm-account-squad-list">
                  {#each linkedSquads as link (link.parentId)}
                    <li>
                      <button
                        type="button"
                        class="evm-account-squad-link"
                        on:click={() => openSquadDashboard(link.parentId)}
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
                name={isAdvancedRow(acc) ? 'active_advanced_evm_account' : 'active_evm_account'}
                checked={isAdvancedRow(acc) ? acc.isActiveAdvanced : acc.isActive}
                disabled={accountsLoading}
                on:change={() =>
                  isAdvancedRow(acc) ? onSetActiveAdvancedAccount(acc.id) : onSetActiveAccount(acc.id)}
              />
              <span class="wallet-view-account-meta">
                <span class="wallet-view-account-scheme">{evmAccountSchemeLabel(acc.scheme)}</span>
                {#if acc.hdIndex != null}
                  <span class="wallet-view-account-idx">#{acc.hdIndex}</span>
                {/if}
                {#if acc.label?.trim()}
                  <span class="wallet-view-account-name">· {acc.label.trim()}</span>
                {/if}
              </span>
            </label>

            <code class="wallet-view-account-addr" title={acc.address}>{shortAddr(acc.address)}</code>
            <div class="wallet-view-account-tools">
              {#if acc.isActive && !isAdvancedRow(acc)}
                <span class="wallet-view-account-badge">Signer</span>
              {/if}
              {#if acc.isDefaultShared && !isAdvancedRow(acc)}
                <span class="wallet-view-account-badge">Receiver</span>
              {/if}
              {#if acc.isActiveAdvanced && isAdvancedRow(acc)}
                <span class="wallet-view-account-badge">Advanced signer</span>
              {/if}
              <button
                type="button"
                class="wallet-view-account-more"
                disabled={accountsLoading}
                aria-label="Edit account name"
                title="Edit display name"
                on:click={() => onEditAccount(acc)}
              >
                <svg
                  class="wallet-view-account-edit-svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.75"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </button>
              <button
                type="button"
                class="wallet-view-account-copy-icon-btn"
                disabled={accountsLoading || !acc.address?.trim()}
                aria-label="Copy address to clipboard"
                title="Copy address"
                on:click|stopPropagation={() => copyAddress(acc.address)}
              >
                <svg
                  class="wallet-view-account-copy-svg"
                  width="18"
                  height="18"
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
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if embeddedInSettings}
    <div class="evm-advanced-actions">
      <h3 class="evm-advanced-actions-title">Advanced EVM accounts</h3>
      <p class="wallet-view-hint evm-advanced-actions-hint">
        Experimental keys for opaque contract calls — not linked to squads or your profile.
      </p>
      <div class="wallet-view-account-actions">
        <button
          type="button"
          class="wallet-view-btn wallet-view-btn-secondary"
          disabled={!evmAddress}
          on:click={onAddAdvanced}
        >
          Add advanced account
        </button>
        <button
          type="button"
          class="wallet-view-btn wallet-view-btn-secondary"
          disabled={!evmAddress}
          on:click={onImportKey}
        >
          Import private key
        </button>
      </div>
      {#if advancedList.length > 0}
        <ul class="wallet-view-account-list evm-advanced-list">
          {#each advancedList as acc (acc.id)}
            <li class="wallet-view-account-row evm-account-row evm-advanced-row">
              <code class="wallet-view-account-addr evm-account-addr-full" title={acc.address}>{acc.address}</code>
              <div class="evm-account-meta-row">
                <div class="evm-account-badges">
                  {#if acc.isActiveAdvanced}
                    <span class="wallet-view-account-badge">Advanced signer</span>
                  {/if}
                  {#if acc.label?.trim()}
                    <span class="wallet-view-account-name">{acc.label.trim()}</span>
                  {/if}
                </div>
                <div class="wallet-view-account-tools evm-account-tools-inline">
                <button
                  type="button"
                  class="wallet-view-btn-export-key"
                  disabled={accountsLoading}
                  on:click={() => openExportModal(acc)}
                >
                  Export key
                </button>
                <button
                  type="button"
                  class="wallet-view-account-more"
                  disabled={accountsLoading}
                  aria-label="Edit account name"
                  title="Edit display name"
                  on:click={() => onEditAccount(acc)}
                >
                  <svg
                    class="wallet-view-account-edit-svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.75"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
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

  .evm-section :global(.wallet-view-hint) {
    margin: 0 0 12px 0;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--text-muted);
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
    background: var(--accent);
    color: #fff;
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

  .evm-section :global(.wallet-view-account-scheme) {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .evm-section :global(.wallet-view-account-idx) {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .evm-section :global(.wallet-view-account-badge) {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--accent);
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

  .evm-section :global(.wallet-view-account-more),
  .evm-section :global(.wallet-view-account-copy-icon-btn),
  .evm-section :global(.wallet-view-btn-export-key) {
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

  .evm-section :global(.wallet-view-account-more) {
    width: 2rem;
    height: 2rem;
    padding: 0;
    min-width: unset;
  }

  .evm-section :global(.wallet-view-account-edit-svg) {
    display: block;
  }

  .evm-section :global(.wallet-view-account-copy-icon-btn) {
    width: 2rem;
    height: 2rem;
    padding: 0;
  }

  .evm-section :global(.wallet-view-btn-export-key) {
    min-height: 2rem;
    padding: 0 10px;
    font-size: 0.8125rem;
    font-weight: 600;
    white-space: nowrap;
    transition: border-color 0.2s;
  }

  .evm-section :global(.wallet-view-btn-export-key:hover) {
    border-color: var(--accent);
  }

  .evm-section :global(.wallet-view-account-more:hover) {
    border-color: var(--accent);
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
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .evm-account-addr-full {
    font-size: 0.8125rem;
    word-break: break-all;
    white-space: normal;
  }

  .evm-account-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }

  .evm-account-meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .evm-account-tools-inline {
    flex-shrink: 0;
    justify-content: flex-end;
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
    color: var(--accent);
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

  .evm-advanced-actions {
    margin-top: 28px;
    padding-top: 24px;
    border-top: 1px solid var(--border-subtle);
  }

  .evm-advanced-actions-title {
    margin: 0 0 6px;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .evm-advanced-actions-hint {
    margin-bottom: 12px !important;
  }

  .evm-advanced-list {
    margin-top: 12px;
  }

  .evm-advanced-row {
    gap: 8px;
  }
</style>
