<script lang="ts">
  import { onMount } from 'svelte';
  import {
    bindingsByAccountId,
    listEvmAccountSquadBindings,
    type EvmAccountSquadBinding,
  } from '../../lib/squad/evm-account-squad-bindings';
  import { openSquadDashboard } from '../../lib/navigation/open-squad-dashboard';
  import { squads } from '../../stores/app';
  import {
    evmAccountSchemeLabel,
    squadEvmAccounts,
    advancedEvmAccounts,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import { copyTextToClipboard } from '../../lib/wallet/clipboard-copy';
  import { showToast } from '../../stores/toast';
  import EvmAccountKeyExportModal from './EvmAccountKeyExportModal.svelte';

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
  $: displayRows = [...squadList, ...advancedList];

  $: accountNpub, evmAccountList, void loadBindings();

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

  async function copyAddress(address: string) {
    const t = address.trim();
    if (!t) return;
    const ok = await copyTextToClipboard(t);
    showToast(ok ? 'Address copied' : 'Could not copy address');
  }

  function squadName(parentId: string): string {
    const squad = $squads.find((s) => s.id === parentId);
    return squad?.name?.trim() || parentId;
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

<section class="evm-section wallet-view-section" aria-labelledby="wallet-evm-accounts-heading">
  <div class="wallet-view-section-head">
    <h2 id="wallet-evm-accounts-heading" class="wallet-view-h2">EVM accounts</h2>
    <div class="wallet-view-account-actions">
      <button
        type="button"
        class="wallet-view-btn wallet-view-btn-secondary"
        disabled={!evmAddress}
        on:click={onAddSquad}
      >
        Add new account
      </button>
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
  </div>

  <p class="wallet-view-hint">
    Derived squad keys power DM wallet, roster shares, treasury deploy, and governance. Advanced imported keys are for
    experimental contract calls only. Set signer and receiver in <strong>Default wallet config</strong> above.
  </p>

  {#if accountsLoading && displayRows.length === 0}
    <p class="wallet-view-empty">Loading accounts…</p>
  {:else if displayRows.length === 0}
    <p class="wallet-view-empty">No EVM accounts yet. Unlock your wallet or add one from your recovery phrase.</p>
  {:else}
    <ul class="wallet-view-account-list evm-accounts-list">
      {#each displayRows as acc (acc.id)}
        {@const linkedSquads = squadBindingsFor(acc)}
        <li
          class="wallet-view-account-row evm-account-row"
          class:wallet-view-account-active={!embeddedInSettings && (acc.isActive || acc.isActiveAdvanced)}
        >
          {#if !embeddedInSettings}
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
          {:else}
            <div class="evm-account-primary">
              <code class="wallet-view-account-addr evm-account-addr-full" title={acc.address}>{acc.address}</code>
              <div class="evm-account-badges">
                <span class="wallet-view-account-scheme">{evmAccountSchemeLabel(acc.scheme)}</span>
                {#if acc.isActive && !isAdvancedRow(acc)}
                  <span class="wallet-view-account-badge">Signer</span>
                {/if}
                {#if acc.isDefaultShared && !isAdvancedRow(acc)}
                  <span class="wallet-view-account-badge">Receiver</span>
                {/if}
                {#if acc.isActiveAdvanced && isAdvancedRow(acc)}
                  <span class="wallet-view-account-badge">Advanced signer</span>
                {/if}
                {#if acc.label?.trim()}
                  <span class="wallet-view-account-name">{acc.label.trim()}</span>
                {/if}
              </div>
            </div>
          {/if}

          {#if !embeddedInSettings}
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
                …
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
          {:else}
            <div class="evm-account-secondary">
              <div class="evm-account-squads">
                {#if bindingsLoading}
                  <span class="evm-account-squad-muted">Loading squad links…</span>
                {:else if linkedSquads.length === 0}
                  <span class="evm-account-squad-muted">Not linked to a squad</span>
                {:else}
                  {#each linkedSquads as link (link.parentId)}
                    <button
                      type="button"
                      class="evm-account-squad-link"
                      on:click={() => openSquadDashboard(link.parentId)}
                    >
                      {squadName(link.parentId)}
                      <span class="evm-account-squad-id">{link.parentId}</span>
                    </button>
                  {/each}
                {/if}
              </div>
              <div class="wallet-view-account-tools">
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
                  …
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
          {/if}
        </li>
      {/each}
    </ul>
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
  }

  .evm-section :global(.wallet-view-account-more) {
    min-width: 2.25rem;
    height: 2rem;
    padding: 0 0.35rem;
    font-size: 1rem;
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
  }

  .evm-account-secondary {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .evm-account-squads {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 180px;
  }

  .evm-account-squad-muted {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .evm-account-squad-link {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font-size: 0.875rem;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    outline: none;
  }

  .evm-account-squad-link:hover {
    text-decoration: underline;
  }

  .evm-account-squad-id {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: ui-monospace, 'Courier New', monospace;
  }
</style>
