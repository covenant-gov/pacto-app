<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
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
  import { appConfig } from '../../stores/app-config';

  const tFn = get(t);

  /** When true, omit the standalone page title (embedded under Settings → EVM). */
  export let embeddedInSettings = false;

  let importModalOpen = false;
  let homeSendOpen = false;
  let receiveOpen = false;
  let watchedRows: WatchedErc20Row[] = [];
  let enabledSet = new Set<SupportedChainId>(defaultWalletEnabledChains());
  let tokenNetworkFilter: 'all' | SupportedChainId = DEFAULT_PREFERRED_NETWORK;

  $: walletAccountLabelMaxLength = $appConfig.walletAccountLabelMaxLength;

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
          showToast(tFn('wallet.receivingAddressSaved'));
        } else {
          showToast(get(t)('wallet.accountAdded'));
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
          showToast(tFn('wallet.receivingAddressSaved'));
        } else {
          showToast(tFn('wallet.accountUpdated'));
        }
      }
      accountFormMode = null;
      resetAccountFormFields();
      await refreshEvmAddress();
    } catch (e) {
      showToast(
        getInvokeErrorMessage(e, mode === 'add' ? tFn('wallet.couldNotAddAccount') : tFn('wallet.couldNotUpdateAccount'))
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
      showToast(getInvokeErrorMessage(e, tFn('wallet.couldNotSwitchAccount')));
    }
  }

  async function onSetActiveAdvancedAccount(id: string) {
    try {
      await setActiveAdvancedEvmAccount(id);
      await refreshEvmAddress();
      showToast(tFn('wallet.advancedSigningAccountUpdated'));
    } catch (e) {
      showToast(getInvokeErrorMessage(e, tFn('wallet.couldNotSwitchAdvancedAccount')));
    }
  }

  async function submitImportKey() {
    if (!importKeyInput.trim()) {
      showToast(tFn('wallet.pastePrivateKey'));
      return;
    }
    importKeyBusy = true;
    try {
      await importEvmAccountRow(importKeyInput.trim());
      importKeyModalOpen = false;
      importKeyInput = '';
      await refreshEvmAddress();
      showToast(tFn('wallet.advancedAccountImported'));
    } catch (e) {
      showToast(getInvokeErrorMessage(e, tFn('wallet.importFailed')));
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
        <h1 id="wallet-view-title" class="wallet-view-title">{$t('wallet.evmWalletTitle')}</h1>
        <p class="wallet-view-lead">
          {$t('wallet.evmWalletLead', { values: { dms: $t('wallet.dmWallet'), settings: $t('wallet.settings') } })}
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
          <h2 id="wallet-actions-heading" class="visually-hidden">{$t('wallet.walletActions')}</h2>
          <div class="wallet-view-action-row">
            <button
              type="button"
              class="wallet-view-btn wallet-view-btn-action"
              on:click={() => (homeSendOpen = true)}
              disabled={!evmAddress}
            >
              {$t('wallet.send')}
            </button>
            <button
              type="button"
              class="wallet-view-btn wallet-view-btn-action wallet-view-btn-action-secondary"
              on:click={() => (receiveOpen = true)}
              disabled={!evmAddress}
            >
              {$t('wallet.receive')}
            </button>
          </div>
          {#if !evmAddress}
            <p class="wallet-view-hint wallet-view-hint-tight">{$t('wallet.unlockWalletHint')}</p>
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
        {$t('wallet.alphaSoftware', { values: { docsPath: $t('wallet.docsPath') } })}
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
        {accountFormIsAdvanced ? $t('wallet.addAdvancedAccount') : $t('wallet.addNewAccount')}
      {:else if accountFormIsAdvanced}
        {$t('wallet.editAdvancedAccount')}
      {:else}
        {$t('wallet.editSquadAccount')}
      {/if}
    </h2>
    {#if accountFormMode === 'add'}
      {#if accountFormIsAdvanced}
        <p class="wallet-view-hint wallet-view-hint-warn">
          {$t('wallet.advancedAccountWarning')}
        </p>
        <p class="wallet-view-hint">
          {$t('wallet.advancedAccountCreateHint')}
        </p>
      {:else}
        <p class="wallet-view-hint">
          {$t('wallet.squadAccountCreateHint')}
        </p>
      {/if}
    {:else if accountFormIsAdvanced}
      <p class="wallet-view-hint">{$t('wallet.advancedAccountEditHint')}</p>
    {:else if embeddedInSettings}
      <p class="wallet-view-hint">{$t('wallet.squadAccountEditHintSettings')}</p>
    {:else}
      <p class="wallet-view-hint">
        {$t('wallet.squadAccountEditHint')}
      </p>
    {/if}
    <label class="wallet-view-edit-label" for="account-form-name">{$t('wallet.nameLabel')}</label>
    <input
      id="account-form-name"
      type="text"
      class="wallet-view-add-account-input"
      maxlength={walletAccountLabelMaxLength}
      placeholder={$t('wallet.accountNamePlaceholder')}
      bind:value={accountFormLabel}
      disabled={accountFormBusy}
    />
    {#if !accountFormIsAdvanced && !embeddedInSettings}
      <label class="wallet-view-import-check">
        <input type="checkbox" bind:checked={accountFormSetSigning} disabled={accountFormBusy} />
        {$t('wallet.useAsSigningAddress')}
      </label>
      <label class="wallet-view-import-check">
        <input type="checkbox" bind:checked={accountFormSetReceiving} disabled={accountFormBusy} />
        {$t('wallet.useAsReceivingAddress')}
      </label>
    {/if}
    <div class="wallet-view-modal-actions">
      <button
        type="button"
        class="wallet-view-btn wallet-view-btn-secondary"
        disabled={accountFormBusy}
        on:click={closeAccountFormModal}
      >
        {$t('wallet.cancel')}
      </button>
      <button type="button" class="wallet-view-btn" disabled={accountFormBusy} on:click={submitAccountForm}>
        {#if accountFormBusy}
          {accountFormMode === 'add' ? $t('wallet.adding') : $t('wallet.saving')}
        {:else if accountFormMode === 'add'}
          {$t('wallet.addAccount')}
        {:else}
          {$t('wallet.save')}
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
    <h2 id="import-pk-title" class="wallet-view-h2">{$t('wallet.importAdvancedPrivateKey')}</h2>
    <p class="wallet-view-hint wallet-view-hint-warn">
      {$t('wallet.importedKeyWarning')}
    </p>
    <p class="wallet-view-hint">
      {$t('wallet.importedKeyHint')}
    </p>
    <textarea
      class="wallet-view-import-textarea"
      rows="3"
      placeholder={$t('wallet.privateKeyPlaceholder')}
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
        {$t('wallet.cancel')}
      </button>
      <button type="button" class="wallet-view-btn" disabled={importKeyBusy} on:click={submitImportKey}>
        {importKeyBusy ? $t('wallet.importing') : $t('wallet.import')}
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
