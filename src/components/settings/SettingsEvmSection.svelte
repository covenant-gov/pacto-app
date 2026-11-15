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
  import SettingsFormModal from './SettingsFormModal.svelte';
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
  <SettingsFormModal
    titleId="account-form-title"
    title={accountFormMode === 'add' ? $t('wallet.addAdvancedAccount') : $t('wallet.editAdvancedAccount')}
    busy={accountFormBusy}
    primaryLabel={accountFormMode === 'add' ? $t('wallet.addAccount') : $t('wallet.save')}
    primaryBusyLabel={accountFormMode === 'add' ? $t('wallet.adding') : $t('wallet.saving')}
    cancelLabel={$t('wallet.cancel')}
    onClose={closeAccountFormModal}
    onPrimary={submitAccountForm}
  >
    {#if accountFormMode === 'add'}
      <p class="settings-form-warn">{$t('wallet.advancedAccountWarning')}</p>
    {/if}
    <label class="settings-form-field" for="settings-account-form-name">
      <span class="settings-form-label">{$t('wallet.nameLabel')}</span>
      <input
        id="settings-account-form-name"
        type="text"
        class="settings-form-input"
        maxlength={walletAccountLabelMaxLength}
        placeholder={$t('wallet.accountNamePlaceholder')}
        bind:value={accountFormLabel}
        disabled={accountFormBusy}
      />
    </label>
  </SettingsFormModal>
{/if}

{#if importKeyModalOpen}
  <SettingsFormModal
    titleId="import-pk-title"
    title={$t('wallet.importAdvancedPrivateKey')}
    busy={importKeyBusy}
    primaryLabel={$t('wallet.import')}
    primaryBusyLabel={$t('wallet.importing')}
    cancelLabel={$t('wallet.cancel')}
    onClose={() => {
      if (!importKeyBusy) {
        importKeyModalOpen = false;
        importKeyInput = '';
      }
    }}
    onPrimary={submitImportKey}
  >
    <p class="settings-form-warn">{$t('wallet.importedKeyWarning')}</p>
    <textarea
      id="settings-import-pk-input"
      class="settings-form-textarea"
      rows="3"
      aria-label={$t('wallet.importAdvancedPrivateKey')}
      placeholder={$t('wallet.privateKeyPlaceholder')}
      bind:value={importKeyInput}
      disabled={importKeyBusy}
    ></textarea>
  </SettingsFormModal>
{/if}
