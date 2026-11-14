<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { getEvmAddress } from '../../lib/api/auth';
  import { currentUser } from '../../stores/auth-session';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { showToast } from '../../stores/toast';
  import {
    listEvmAccounts,
    addEvmAccountRow,
    updateEvmAccountRow,
    setActiveEvmAccount,
    squadEvmAccounts,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import DefaultWalletConfig from '../settings/DefaultWalletConfig.svelte';
  import EvmAccountsSection from '../settings/EvmAccountsSection.svelte';
  import { portal } from '../../lib/utils/portal';
  import { appConfig } from '../../stores/app-config';

  const tFn = get(t);

  interface Props {
    evmAccountList?: EvmAccountRow[];
    accountsLoading?: boolean;
    accountsEpoch?: number;
    onRefresh?: () => void | Promise<void>;
  }

  let {
    evmAccountList = $bindable([]),
    accountsLoading = $bindable(false),
    accountsEpoch = 0,
    onRefresh = () => {},
  }: Props = $props();

  const accountNpub = $derived($currentUser?.npub ?? null);
  const walletAccountLabelMaxLength = $derived($appConfig.walletAccountLabelMaxLength);
  const squadAccountList = $derived(squadEvmAccounts(evmAccountList));

  let evmAddress: string | null = $state(null);
  let accountFormMode: 'add' | 'edit' | null = $state(null);
  let accountFormEditId: string | null = $state(null);
  let accountFormLabel = $state('');
  let accountFormBusy = $state(false);

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
    await onRefresh();
  }

  $effect(() => {
    void accountNpub;
    void accountsEpoch;
    void refreshEvmAddress();
  });

  function resetAccountFormFields() {
    accountFormLabel = '';
    accountFormEditId = null;
  }

  function closeAccountFormModal() {
    if (accountFormBusy) return;
    accountFormMode = null;
    resetAccountFormFields();
  }

  function openAddAccountModal() {
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
          purpose: 'squad',
        });
        showToast(get(t)('wallet.accountAdded'));
      } else if (editId) {
        const existing = evmAccountList.find((a) => a.id === editId);
        await updateEvmAccountRow({
          accountId: editId,
          label: accountFormLabel,
          setActiveSigner: existing?.isActive ?? false,
          setDefaultShared: existing?.isDefaultShared ?? false,
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

  async function onSetActiveAccount(id: string) {
    try {
      await setActiveEvmAccount(id);
      await refreshEvmAddress();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, tFn('wallet.couldNotSwitchAccount')));
    }
  }
</script>

{#if accountNpub}
  <DefaultWalletConfig
    accountNpub={accountNpub}
    squadAccounts={squadAccountList}
    accountsLoading={accountsLoading}
    onSaved={refreshEvmAddress}
  />

  <EvmAccountsSection
    {accountNpub}
    {evmAddress}
    embeddedInSettings={true}
    showSquadList={true}
    showAdvancedBlock={false}
    {evmAccountList}
    {accountsLoading}
    {onSetActiveAccount}
    onEditAccount={openEditAccountModal}
    onAddSquad={openAddAccountModal}
  />
{/if}

{#if accountFormMode}
  <div use:portal>
    <div class="wallet-view-modal-backdrop" role="presentation" onclick={closeAccountFormModal}></div>
    <div class="wallet-view-modal" role="dialog" aria-labelledby="account-form-title" aria-modal="true">
      <h2 id="account-form-title" class="wallet-view-h2">
        {accountFormMode === 'add' ? $t('wallet.addNewAccount') : $t('wallet.editSquadAccount')}
      </h2>
      <p class="wallet-view-hint">
        {accountFormMode === 'add' ? $t('wallet.squadAccountCreateHint') : $t('wallet.squadAccountEditHintSettings')}
      </p>
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
