<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { getEvmAddress } from '../../lib/api/auth';
  import { currentUser } from '../../stores/auth-session';
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
  import WalletImportTokensModal from '../wallet/WalletImportTokensModal.svelte';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { showToast } from '../../stores/toast';
  import {
    listEvmAccounts,
    addEvmAccountRow,
    updateEvmAccountRow,
    importEvmAccountRow,
    setActiveAdvancedEvmAccount,
    advancedEvmAccounts,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import WalletAdvancedPanel from '../wallet/WalletAdvancedPanel.svelte';
  import EvmAccountsSection from './EvmAccountsSection.svelte';
  import EvmWalletExtras from './EvmWalletExtras.svelte';
  import { portal } from '../../lib/utils/portal';
  import { appConfig } from '../../stores/app-config';
  import { featureEnabled } from '../../stores/feature-flags';

  const tFn = get(t);

  const accountNpub = $derived($currentUser?.npub ?? null);
  const walletAccountLabelMaxLength = $derived($appConfig.walletAccountLabelMaxLength);
  const advancedAccountsEnabled = featureEnabled('advanced_evm_accounts');

  let importModalOpen = $state(false);
  let watchedRows: WatchedErc20Row[] = $state([]);
  let enabledSet = $state(new Set<SupportedChainId>(defaultWalletEnabledChains()));
  let tokenNetworkFilter: 'all' | SupportedChainId = $state(DEFAULT_PREFERRED_NETWORK);
  let evmAddress: string | null = $state(null);
  let evmAccountList: EvmAccountRow[] = $state([]);
  let accountsLoading = $state(false);
  let importKeyModalOpen = $state(false);
  let importKeyInput = $state('');
  let importKeyBusy = $state(false);
  let accountFormMode: 'add' | 'edit' | null = $state(null);
  let accountFormEditId: string | null = $state(null);
  let accountFormLabel = $state('');
  let accountFormBusy = $state(false);

  const showAdvancedPanel = $derived(
    $advancedAccountsEnabled || advancedEvmAccounts(evmAccountList).length > 0,
  );
  const enabledChainsOrdered = $derived(WALLET_ASSETS_CHAIN_IDS.filter((id) => enabledSet.has(id)));

  async function loadEvmAccountsList() {
    if (!accountNpub) {
      evmAccountList = [];
      accountsLoading = false;
      return;
    }
    accountsLoading = true;
    try {
      evmAccountList = (await listEvmAccounts()) ?? [];
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

  $effect(() => {
    void accountNpub;
    void refreshEvmAddress();
  });

  function syncFromDisk() {
    if (!accountNpub) return;
    watchedRows = loadWatchedErc20Rows(accountNpub);
    enabledSet = new Set(loadWalletEnabledChains(accountNpub));
  }

  $effect(() => {
    void accountNpub;
    void $walletUiEnabledChainsTick;
    syncFromDisk();
  });

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
    accountFormEditId = null;
  }

  function closeAccountFormModal() {
    if (accountFormBusy) return;
    accountFormMode = null;
    resetAccountFormFields();
  }

  function openAddAdvancedModal() {
    resetAccountFormFields();
    accountFormMode = 'add';
  }

  function openEditAccountModal(acc: EvmAccountRow) {
    accountFormMode = 'edit';
    accountFormEditId = acc.id;
    accountFormLabel = acc.label ?? '';
  }

  async function submitAccountForm() {
    if (!accountNpub || accountFormBusy || !accountFormMode) return;
    const mode = accountFormMode;
    const editId = accountFormEditId;
    if (mode === 'edit' && !editId) return;
    accountFormBusy = true;
    try {
      if (mode === 'add') {
        await addEvmAccountRow({
          label: accountFormLabel,
          setActiveSigner: false,
          setDefaultShared: false,
          purpose: 'advanced',
        });
        showToast(get(t)('wallet.accountAdded'));
      } else if (editId) {
        await updateEvmAccountRow({
          accountId: editId,
          label: accountFormLabel,
          setActiveSigner: false,
          setDefaultShared: false,
        });
        showToast(tFn('wallet.accountUpdated'));
      }
      accountFormMode = null;
      resetAccountFormFields();
      await refreshEvmAddress();
    } catch (e) {
      showToast(
        getInvokeErrorMessage(e, mode === 'add' ? tFn('wallet.couldNotAddAccount') : tFn('wallet.couldNotUpdateAccount')),
      );
    } finally {
      accountFormBusy = false;
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
</script>

{#if accountNpub}
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

  <EvmAccountsSection
    {accountNpub}
    {evmAddress}
    embeddedInSettings={true}
    showSquadList={false}
    showAdvancedBlock={true}
    {evmAccountList}
    {accountsLoading}
    onSetActiveAdvancedAccount={onSetActiveAdvancedAccount}
    onEditAccount={openEditAccountModal}
    onAddAdvanced={openAddAdvancedModal}
    onImportKey={() => {
      importKeyModalOpen = true;
    }}
  />

  {#if showAdvancedPanel}
    <WalletAdvancedPanel enabledChainIds={enabledChainsOrdered} embeddedInSettings />
  {/if}

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
{/if}

{#if accountFormMode}
  <div use:portal>
    <div class="wallet-view-modal-backdrop" role="presentation" onclick={closeAccountFormModal}></div>
    <div class="wallet-view-modal" role="dialog" aria-labelledby="account-form-title" aria-modal="true">
      <h2 id="account-form-title" class="wallet-view-h2">
        {accountFormMode === 'add' ? $t('wallet.addAdvancedAccount') : $t('wallet.editAdvancedAccount')}
      </h2>
      {#if accountFormMode === 'add'}
        <p class="wallet-view-hint wallet-view-hint-warn">{$t('wallet.advancedAccountWarning')}</p>
        <p class="wallet-view-hint">{$t('wallet.advancedAccountCreateHint')}</p>
      {:else}
        <p class="wallet-view-hint">{$t('wallet.advancedAccountEditHint')}</p>
      {/if}
      <label class="wallet-view-edit-label" for="settings-account-form-name">{$t('wallet.nameLabel')}</label>
      <input
        id="settings-account-form-name"
        type="text"
        class="wallet-view-add-account-input"
        maxlength={walletAccountLabelMaxLength}
        placeholder={$t('wallet.accountNamePlaceholder')}
        bind:value={accountFormLabel}
        disabled={accountFormBusy}
      />
      <div class="wallet-view-modal-actions">
        <button type="button" class="wallet-view-btn wallet-view-btn-secondary" disabled={accountFormBusy} onclick={closeAccountFormModal}>
          {$t('wallet.cancel')}
        </button>
        <button type="button" class="wallet-view-btn" disabled={accountFormBusy} onclick={submitAccountForm}>
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
      onclick={() => {
        if (!importKeyBusy) importKeyModalOpen = false;
      }}
    ></div>
    <div class="wallet-view-modal" role="dialog" aria-labelledby="import-pk-title" aria-modal="true">
      <h2 id="import-pk-title" class="wallet-view-h2">{$t('wallet.importAdvancedPrivateKey')}</h2>
      <p class="wallet-view-hint wallet-view-hint-warn">{$t('wallet.importedKeyWarning')}</p>
      <p class="wallet-view-hint">{$t('wallet.importedKeyHint')}</p>
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
          onclick={() => {
            importKeyModalOpen = false;
            importKeyInput = '';
          }}
        >
          {$t('wallet.cancel')}
        </button>
        <button type="button" class="wallet-view-btn" disabled={importKeyBusy} onclick={submitImportKey}>
          {importKeyBusy ? $t('wallet.importing') : $t('wallet.import')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
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
  }

  .wallet-view-h2 {
    margin: 0 0 8px;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .wallet-view-hint {
    margin: 0 0 12px;
    font-size: 0.875rem;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .wallet-view-hint-warn {
    color: var(--warning);
  }

  .wallet-view-edit-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 4px 0 6px;
  }

  .wallet-view-add-account-input,
  .wallet-view-import-textarea {
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

  .wallet-view-import-textarea {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    resize: vertical;
  }

  .wallet-view-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .wallet-view-btn {
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

  .wallet-view-btn-secondary {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .wallet-view-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
