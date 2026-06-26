<script lang="ts">
  import { onMount } from 'svelte';
  import { getEvmAddress } from '../../lib/api/auth';
  import { currentUser } from '../../stores/auth';
  import {
    loadWalletEnabledChains,
    saveWalletEnabledChains,
    walletUiEnabledChainsTick,
    defaultWalletEnabledChains,
  } from '../../lib/wallet/wallet-ui-prefs';
  import { DEFAULT_PREFERRED_NETWORK } from '../../lib/wallet/preferred-network';
  import type { SupportedChainId } from '../../lib/wallet/chains';
  import { WALLET_ASSETS_CHAIN_IDS } from '../../lib/wallet/assets';
  import {
    loadWatchedErc20Rows,
    saveWatchedErc20Rows,
    type WatchedErc20Row,
  } from '../../lib/wallet/watched-tokens';
  import WalletImportTokensModal from './WalletImportTokensModal.svelte';
  import WalletHomeSendModal from './WalletHomeSendModal.svelte';
  import WalletReceiveModal from './WalletReceiveModal.svelte';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { showToast } from '../../stores/toast';
  import {
    listEvmAccounts,
    addEvmAccountRow,
    updateEvmAccountRow,
    importEvmAccountRow,
    setActiveEvmAccount,
    setActiveAdvancedEvmAccount,
    squadEvmAccounts,
    type EvmAccountPurpose,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import WalletAdvancedPanel from './WalletAdvancedPanel.svelte';
  import DefaultWalletConfig from '../settings/DefaultWalletConfig.svelte';
  import EvmAccountsSection from '../settings/EvmAccountsSection.svelte';
  import EvmWalletExtras from '../settings/EvmWalletExtras.svelte';
  import { portal } from '../../lib/utils/portal';
  import { settingsSectionCollapsed } from '../../lib/settings/settings-section-collapse';

  /** When true, omit the standalone page title (embedded under Settings → EVM). */
  export let embeddedInSettings = false;

  let importModalOpen = false;
  let homeSendOpen = false;
  let receiveOpen = false;
  let watchedRows: WatchedErc20Row[] = [];
  let enabledSet = new Set<SupportedChainId>(defaultWalletEnabledChains());
  let tokenNetworkFilter: 'all' | SupportedChainId = DEFAULT_PREFERRED_NETWORK;

  $: accountNpub = $currentUser?.npub ?? null;

  let evmAddress: string | null = null;

  let evmAccountList: EvmAccountRow[] = [];
  let accountsLoading = false;
  let importKeyModalOpen = false;
  let importKeyInput = '';
  let importKeyBusy = false;

  /** Unified add / edit account modal (same fields as add). */
  let accountFormMode: 'add' | 'edit' | null = null;
  let accountFormPurpose: EvmAccountPurpose = 'squad';
  let accountFormEditId: string | null = null;
  let accountFormLabel = '';
  let accountFormSetSigning = false;
  let accountFormSetReceiving = false;
  let accountFormBusy = false;

  async function loadEvmAccountsList() {
    if (!accountNpub) {
      evmAccountList = [];
      accountsLoading = false;
      return;
    }
    accountsLoading = true;
    try {
      const rows = await listEvmAccounts();
      evmAccountList = rows ?? [];
    } catch (e) {
      evmAccountList = [];
      console.error('list_evm_accounts failed:', e);
    } finally {
      accountsLoading = false;
    }
  }

  async function refreshEvmAddress() {
    if (!accountNpub) {
      evmAddress = null;
      return;
    }
    try {
      const a = await getEvmAddress();
      evmAddress = a?.trim() || null;
    } catch {
      evmAddress = null;
    }
    await loadEvmAccountsList();
  }

  $: accountNpub, void refreshEvmAddress();

  function syncFromDisk() {
    if (!accountNpub) return;
    watchedRows = loadWatchedErc20Rows(accountNpub);
    enabledSet = new Set(loadWalletEnabledChains(accountNpub));
  }

  $: accountNpub, $walletUiEnabledChainsTick, syncFromDisk();

  $: if (
    embeddedInSettings &&
    ($settingsSectionCollapsed['settings-evm'] ?? true)
  ) {
    if (accountFormMode) closeAccountFormModal();
    if (importKeyModalOpen && !importKeyBusy) {
      importKeyModalOpen = false;
      importKeyInput = '';
    }
    if (importModalOpen) importModalOpen = false;
  }

  onMount(syncFromDisk);

  function toggleChain(chain: SupportedChainId) {
    if (!accountNpub) return;
    const next = new Set(enabledSet);
    if (next.has(chain)) {
      if (next.size <= 1) return;
      next.delete(chain);
    } else {
      next.add(chain);
    }
    enabledSet = next;
    saveWalletEnabledChains(accountNpub, [...next]);
  }

  function removeWatchedRow(row: WatchedErc20Row) {
    if (!accountNpub) return;
    const next = watchedRows.filter((r) => r.id !== row.id);
    watchedRows = next;
    saveWatchedErc20Rows(accountNpub, next);
  }

  function resetAccountFormFields() {
    accountFormLabel = '';
    accountFormSetSigning = false;
    accountFormSetReceiving = false;
    accountFormEditId = null;
  }

  function closeAccountFormModal() {
    if (accountFormBusy) return;
    accountFormMode = null;
    resetAccountFormFields();
  }

  function openAddAccountModal(purpose: EvmAccountPurpose = 'squad') {
    resetAccountFormFields();
    accountFormPurpose = purpose;
    accountFormMode = 'add';
  }

  function openEditAccountModal(acc: EvmAccountRow) {
    accountFormMode = 'edit';
    accountFormEditId = acc.id;
    accountFormPurpose = acc.purpose;
    accountFormLabel = acc.label ?? '';
    accountFormSetSigning = acc.isActive;
    accountFormSetReceiving = acc.isDefaultShared;
  }

  async function submitAccountForm() {
    if (!accountNpub || accountFormBusy || !accountFormMode) return;
    const setReceiving = accountFormSetReceiving;
    const mode = accountFormMode;
    const editId = accountFormEditId;
    if (mode === 'edit' && !editId) return;
    accountFormBusy = true;
    try {
      if (mode === 'add') {
        const isAdvanced = accountFormPurpose === 'advanced';
        await addEvmAccountRow({
          label: accountFormLabel,
          setActiveSigner: isAdvanced ? false : accountFormSetSigning,
          setDefaultShared: isAdvanced ? false : accountFormSetReceiving,
          purpose: accountFormPurpose,
        });
        if (setReceiving) {
          showToast('Receiving address saved. Publishing profile metadata…');
        } else {
          showToast('Account added.');
        }
      } else if (editId) {
        const isAdvanced = accountFormPurpose === 'advanced';
        const existing = evmAccountList.find((a) => a.id === editId);
        const setSigning = embeddedInSettings
          ? (existing?.isActive ?? false)
          : isAdvanced
            ? false
            : accountFormSetSigning;
        const setShared = embeddedInSettings
          ? (existing?.isDefaultShared ?? false)
          : isAdvanced
            ? false
            : accountFormSetReceiving;
        await updateEvmAccountRow({
          accountId: editId,
          label: accountFormLabel,
          setActiveSigner: setSigning,
          setDefaultShared: setShared,
        });
        if (setReceiving) {
          showToast('Receiving address saved. Publishing profile metadata…');
        } else {
          showToast('Account updated.');
        }
      }
      accountFormMode = null;
      resetAccountFormFields();
      await refreshEvmAddress();
    } catch (e) {
      showToast(
        getInvokeErrorMessage(e, mode === 'add' ? 'Could not add account.' : 'Could not update account.')
      );
    } finally {
      accountFormBusy = false;
    }
  }

  async function onSetActiveAccount(id: string) {
    try {
      await setActiveEvmAccount(id);
      await refreshEvmAddress();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Could not switch account.'));
    }
  }

  async function onSetActiveAdvancedAccount(id: string) {
    try {
      await setActiveAdvancedEvmAccount(id);
      await refreshEvmAddress();
      showToast('Advanced signing account updated.');
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Could not switch advanced account.'));
    }
  }

  async function submitImportKey() {
    if (!importKeyInput.trim()) {
      showToast('Paste a private key (0x + 64 hex).');
      return;
    }
    importKeyBusy = true;
    try {
      await importEvmAccountRow(importKeyInput.trim());
      importKeyModalOpen = false;
      importKeyInput = '';
      await refreshEvmAddress();
      showToast('Advanced account imported. Not used for squad roster or governance.');
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Import failed.'));
    } finally {
      importKeyBusy = false;
    }
  }

  /** Enabled chains in catalog order (Send network list + settings). */
  $: enabledChainsOrdered = WALLET_ASSETS_CHAIN_IDS.filter((id) => enabledSet.has(id));

  /** Kind 0 / profile default; when unset, receiving matches the signing address. */
  $: profileDefaultEvmAddress = evmAccountList.find((a) => a.isDefaultShared)?.address?.trim() || null;
  $: displayReceivingAddress = profileDefaultEvmAddress ?? evmAddress;
  $: squadAccountList = squadEvmAccounts(evmAccountList);
  $: accountFormIsAdvanced = accountFormPurpose === 'advanced';
</script>

<div class="wallet-view" class:wallet-view--embedded={embeddedInSettings} aria-labelledby={embeddedInSettings ? undefined : 'wallet-view-title'}>
  <div class="wallet-view-inner">
    {#if !embeddedInSettings}
      <header class="wallet-view-header">
        <h1 id="wallet-view-title" class="wallet-view-title">EVM Wallet</h1>
        <p class="wallet-view-lead">
          Your embedded EVM wallet: send to any address, receive by sharing your address, and manage networks and tokens. Payment requests with
          contacts stay in <strong>DMs</strong> (in-chat wallet panel). Nostr profile, backup, and logout: <strong>Settings</strong>.
        </p>
      </header>
    {/if}

    {#if accountNpub}
      {#if embeddedInSettings}
        <section class="wallet-view-section" aria-labelledby="wallet-default-evm-heading">
          <DefaultWalletConfig
            accountNpub={accountNpub}
            squadAccounts={squadAccountList}
            accountsLoading={accountsLoading}
            onSaved={refreshEvmAddress}
          />
        </section>
      {:else}
        <section class="wallet-view-section wallet-view-actions-section" aria-labelledby="wallet-actions-heading">
          <h2 id="wallet-actions-heading" class="visually-hidden">Wallet actions</h2>
          <div class="wallet-view-action-row">
            <button
              type="button"
              class="wallet-view-btn wallet-view-btn-action"
              on:click={() => (homeSendOpen = true)}
              disabled={!evmAddress}
            >
              Send
            </button>
            <button
              type="button"
              class="wallet-view-btn wallet-view-btn-action wallet-view-btn-action-secondary"
              on:click={() => (receiveOpen = true)}
              disabled={!evmAddress}
            >
              Receive
            </button>
          </div>
          {#if !evmAddress}
            <p class="wallet-view-hint wallet-view-hint-tight">Unlock or wait for your wallet address to load to use Send and Receive.</p>
          {/if}
        </section>
      {/if}
    {/if}

    {#if accountNpub}
      <EvmAccountsSection
        {accountNpub}
        {evmAddress}
        {embeddedInSettings}
        {evmAccountList}
        {accountsLoading}
        onSetActiveAccount={onSetActiveAccount}
        onSetActiveAdvancedAccount={onSetActiveAdvancedAccount}
        onEditAccount={openEditAccountModal}
        onAddSquad={() => openAddAccountModal('squad')}
        onAddAdvanced={() => openAddAccountModal('advanced')}
        onImportKey={() => {
          importKeyModalOpen = true;
        }}
      />

      <EvmWalletExtras
        {accountNpub}
        {enabledSet}
        {watchedRows}
        bind:tokenNetworkFilter
        onToggleChain={toggleChain}
        onRemoveWatchedRow={removeWatchedRow}
        onImportTokens={() => {
          importModalOpen = true;
        }}
      />

      <div class="wallet-view-section">
        <WalletAdvancedPanel enabledChainIds={enabledChainsOrdered} {embeddedInSettings} />
      </div>
    {/if}

    {#if !embeddedInSettings}
      <aside class="wallet-view-alpha" role="note">
        <strong>Alpha software.</strong>
        Wallet and key handling have not been reviewed by an independent security audit. Use only funds you can afford to lose. See
        <code class="wallet-view-code">docs/audits/README.md</code> in the repository.
      </aside>
    {/if}
  </div>
</div>

{#if accountNpub}
  <WalletImportTokensModal
    open={importModalOpen}
    networkScope={tokenNetworkFilter}
    {accountNpub}
    onClose={() => (importModalOpen = false)}
    onSaved={() => {
      syncFromDisk();
      importModalOpen = false;
    }}
  />
  {#if !embeddedInSettings}
    <WalletHomeSendModal
      open={homeSendOpen}
      onClose={() => {
        homeSendOpen = false;
      }}
      watchedAssetRows={watchedRows}
      enabledChainIds={enabledChainsOrdered}
    />
  {/if}
{/if}

{#if !embeddedInSettings}
  <WalletReceiveModal
    open={receiveOpen && !!displayReceivingAddress}
    address={displayReceivingAddress ?? ''}
    onClose={() => (receiveOpen = false)}
  />
{/if}

{#if accountFormMode}
  <div use:portal>
  <div
    class="wallet-view-modal-backdrop"
    role="presentation"
    on:click={closeAccountFormModal}
  ></div>
  <div class="wallet-view-modal" role="dialog" aria-labelledby="account-form-title" aria-modal="true">
    <h2 id="account-form-title" class="wallet-view-h2">
      {#if accountFormMode === 'add'}
        {accountFormIsAdvanced ? 'Add advanced account' : 'Add new account'}
      {:else if accountFormIsAdvanced}
        Edit advanced account
      {:else}
        Edit squad account
      {/if}
    </h2>
    {#if accountFormMode === 'add'}
      {#if accountFormIsAdvanced}
        <p class="wallet-view-hint wallet-view-hint-warn">
          Advanced accounts are not used for squad roster, governance, treasury deploy, or your profile receiving address.
        </p>
        <p class="wallet-view-hint">
          Creates a new derived address from your recovery phrase, tagged advanced-only.
        </p>
      {:else}
        <p class="wallet-view-hint">
          Creates a new squad address from your recovery phrase. Name is optional and only stored on this device.
        </p>
      {/if}
    {:else if accountFormIsAdvanced}
      <p class="wallet-view-hint">Update the display name. Advanced accounts cannot be squad signers or receiving addresses.</p>
    {:else if embeddedInSettings}
      <p class="wallet-view-hint">Update the display name. Signer and receiver are set in Default EVM account above.</p>
    {:else}
      <p class="wallet-view-hint">
        Update the display name and whether this account is the signer or published receiving address. Name is only stored on this device.
      </p>
    {/if}
    <label class="wallet-view-edit-label" for="account-form-name">Name</label>
    <input
      id="account-form-name"
      type="text"
      class="wallet-view-add-account-input"
      maxlength="64"
      placeholder="e.g. Squad Name"
      bind:value={accountFormLabel}
      disabled={accountFormBusy}
    />
    {#if !accountFormIsAdvanced && !embeddedInSettings}
      <label class="wallet-view-import-check">
        <input type="checkbox" bind:checked={accountFormSetSigning} disabled={accountFormBusy} />
        Use as signing address (Send, balances, DM wallet)
      </label>
      <label class="wallet-view-import-check">
        <input type="checkbox" bind:checked={accountFormSetReceiving} disabled={accountFormBusy} />
        Use as receiving address (profile / Kind 0; republishes your profile)
      </label>
    {/if}
    <div class="wallet-view-modal-actions">
      <button
        type="button"
        class="wallet-view-btn wallet-view-btn-secondary"
        disabled={accountFormBusy}
        on:click={closeAccountFormModal}
      >
        Cancel
      </button>
      <button type="button" class="wallet-view-btn" disabled={accountFormBusy} on:click={submitAccountForm}>
        {#if accountFormBusy}
          {accountFormMode === 'add' ? 'Adding…' : 'Saving…'}
        {:else if accountFormMode === 'add'}
          Add account
        {:else}
          Save
        {/if}
      </button>
    </div>
  </div>
  </div>
{/if}

{#if importKeyModalOpen}
  <div use:portal>
  <div
    class="wallet-view-modal-backdrop"
    role="presentation"
    on:click={() => {
      if (!importKeyBusy) importKeyModalOpen = false;
    }}
  ></div>
  <div class="wallet-view-modal" role="dialog" aria-labelledby="import-pk-title" aria-modal="true">
    <h2 id="import-pk-title" class="wallet-view-h2">Import advanced private key</h2>
    <p class="wallet-view-hint wallet-view-hint-warn">
      Imported keys are always advanced-purpose. They cannot be squad signers, roster addresses, or profile receiving addresses.
    </p>
    <p class="wallet-view-hint">
      Paste a standalone Ethereum private key (32-byte secret). It is encrypted like your other keys. Not recoverable from your recovery phrase.
    </p>
    <textarea
      class="wallet-view-import-textarea"
      rows="3"
      placeholder="0x…"
      bind:value={importKeyInput}
      disabled={importKeyBusy}
    ></textarea>
    <div class="wallet-view-modal-actions">
      <button
        type="button"
        class="wallet-view-btn wallet-view-btn-secondary"
        disabled={importKeyBusy}
        on:click={() => {
          importKeyModalOpen = false;
          importKeyInput = '';
        }}
      >
        Cancel
      </button>
      <button type="button" class="wallet-view-btn" disabled={importKeyBusy} on:click={submitImportKey}>
        {importKeyBusy ? 'Importing…' : 'Import'}
      </button>
    </div>
  </div>
  </div>
{/if}

<style>
  .wallet-view {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: auto;
    background: var(--bg-page);
  }

  .wallet-view--embedded {
    background: transparent;
    overflow: visible;
  }

  .wallet-view-inner {
    max-width: 720px;
    margin: 0 auto;
    padding: 28px 32px 48px;
  }

  .wallet-view--embedded .wallet-view-inner {
    max-width: none;
    margin: 0;
    padding: 24px 28px 28px;
  }

  .wallet-view-header {
    margin-bottom: 28px;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .wallet-view-actions-section {
    padding-bottom: 24px;
  }

  .wallet-view-action-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }

  .wallet-view-btn-action {
    min-width: 108px;
  }

  .wallet-view-btn-action-secondary {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .wallet-view-btn-action-secondary:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .wallet-view-btn-action-outline {
    background: transparent;
    color: var(--accent);
    border: 1px dashed var(--border);
  }

  .wallet-view-btn-action-outline:hover {
    border-color: var(--accent);
    background: rgba(80, 200, 180, 0.06);
  }

  .wallet-view-btn-action:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .wallet-view-hint-tight {
    margin-top: 10px;
    margin-bottom: 0;
  }

  .wallet-view-title {
    margin: 0 0 10px;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .wallet-view-lead {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: var(--text-secondary);
  }

  .wallet-view-section {
    margin-bottom: 32px;
    padding-bottom: 28px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .wallet-view-section:last-of-type {
    border-bottom: none;
  }

  .wallet-view-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }

  .wallet-view-h2 {
    margin: 0 0 8px;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .wallet-view-section-head .wallet-view-h2 {
    margin-bottom: 0;
  }

  .wallet-view-hint {
    margin: 0 0 14px;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .wallet-view-hint-warn {
    color: var(--text-primary);
  }

  .wallet-view-toggle-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .wallet-view-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .wallet-view-toggle input {
    accent-color: var(--accent);
  }

  .wallet-view-chain-id {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .wallet-view-btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .wallet-view-btn:hover {
    background: var(--accent-hover);
  }

  .wallet-view-btn-secondary {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .wallet-view-btn-secondary:hover {
    background: var(--bg-hover);
  }

  .wallet-view-token-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .wallet-view-token-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  .wallet-view-token-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    min-width: 0;
  }

  .wallet-view-token-sym {
    font-weight: 600;
    color: var(--text-primary);
  }

  .wallet-view-token-net {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .wallet-view-token-addr {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .wallet-view-token-src {
    font-size: 0.7rem;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .wallet-view-btn-text {
    background: none;
    border: none;
    color: var(--danger);
    font-size: 0.8125rem;
    cursor: pointer;
    flex-shrink: 0;
  }

  .wallet-view-btn-text:hover {
    text-decoration: underline;
  }

  .wallet-view-empty {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .wallet-view-code {
    font-size: 0.8em;
    padding: 2px 6px;
    background: var(--bg-elevated);
    border-radius: 4px;
    word-break: break-all;
  }

  .wallet-view-account-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .wallet-view-account-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .wallet-view-account-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px 14px;
    padding: 12px 14px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  .wallet-view-account-active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px rgba(80, 200, 180, 0.25);
  }

  .wallet-view-account-select {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    margin: 0;
    min-width: 0;
  }

  .wallet-view-account-select input {
    accent-color: var(--accent);
  }

  .wallet-view-account-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .wallet-view-account-scheme {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .wallet-view-account-idx {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: ui-monospace, monospace;
  }

  .wallet-view-account-name {
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .wallet-view-account-addr {
    font-size: 0.78rem;
    color: var(--text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wallet-view-account-tools {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .wallet-view-account-more {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-hover);
    color: var(--text-primary);
    cursor: pointer;
    flex-shrink: 0;
    transition: border-color 0.2s;
  }

  .wallet-view-account-more:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--bg-hover);
  }

  .wallet-view-account-more:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .wallet-view-account-copy-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-hover);
    color: var(--text-primary);
    cursor: pointer;
    flex-shrink: 0;
  }

  .wallet-view-account-copy-icon-btn:hover:not(:disabled) {
    border-color: var(--text-muted);
    background: var(--bg-elevated);
    color: var(--accent);
  }

  .wallet-view-account-copy-icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .wallet-view-account-copy-svg {
    display: block;
  }

  .wallet-view-account-badge {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
  }

  .wallet-view-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 10000;
  }

  .wallet-view-modal {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 10001;
    width: min(420px, calc(100vw - 32px));
    max-height: min(480px, calc(100vh - 48px));
    overflow: auto;
    padding: 22px 22px 18px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
  }

  .wallet-view-modal .wallet-view-h2 {
    margin-top: 0;
  }

  .wallet-view-edit-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 4px 0 6px;
  }

  .wallet-view-add-account-input {
    width: 100%;
    box-sizing: border-box;
    margin: 0 0 14px;
    padding: 10px 12px;
    font-size: 0.9375rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-page);
    color: var(--text-primary);
  }

  .wallet-view-add-account-input:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .wallet-view-import-textarea {
    width: 100%;
    box-sizing: border-box;
    margin: 0 0 12px;
    padding: 10px 12px;
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-page);
    color: var(--text-primary);
    resize: vertical;
  }

  .wallet-view-import-check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin-bottom: 16px;
    cursor: pointer;
  }

  .wallet-view-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
  }

  .wallet-view-alpha {
    margin-top: 8px;
    padding: 14px 16px;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--text-secondary);
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
</style>
