<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { currentUser } from '../../stores/auth-session';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { showToast } from '../../stores/toast';
  import {
    listEvmAccounts,
    addEvmAccountRow,
    updateEvmAccountRow,
    squadEvmAccounts,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import DefaultWalletConfig from '../settings/DefaultWalletConfig.svelte';
  import EvmAccountsSection from '../settings/EvmAccountsSection.svelte';
  import { appConfig } from '../../stores/app-config';
  import SettingsFormModal from '../settings/SettingsFormModal.svelte';

  interface Props {
    evmAccountList?: EvmAccountRow[];
  }

  let { evmAccountList = $bindable([]) }: Props = $props();

  const accountNpub = $derived($currentUser?.npub ?? null);
  const walletAccountLabelMaxLength = $derived($appConfig.walletAccountLabelMaxLength);
  const squadAccountList = $derived(squadEvmAccounts(evmAccountList));
  const evmAddress = $derived(squadAccountList.find((a) => a.isActive)?.address?.trim() || null);

  let accountsLoading = $state(false);
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

  $effect(() => {
    void accountNpub;
    void loadEvmAccountsList();
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
    const tr = get(t);
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
        showToast(tr('wallet.accountAdded'));
      } else if (editId) {
        const existing = evmAccountList.find((a) => a.id === editId);
        await updateEvmAccountRow({
          accountId: editId,
          label: accountFormLabel,
          setActiveSigner: existing?.isActive ?? false,
          setDefaultShared: existing?.isDefaultShared ?? false,
        });
        showToast(tr('wallet.accountUpdated'));
      }
      accountFormMode = null;
      resetAccountFormFields();
      await loadEvmAccountsList();
    } catch (e) {
      showToast(
        getInvokeErrorMessage(e, mode === 'add' ? tr('wallet.couldNotAddAccount') : tr('wallet.couldNotUpdateAccount')),
      );
    } finally {
      accountFormBusy = false;
    }
  }

</script>

{#if accountNpub}
  <DefaultWalletConfig
    accountNpub={accountNpub}
    squadAccounts={squadAccountList}
    accountsLoading={accountsLoading}
    onSaved={loadEvmAccountsList}
  />

  <EvmAccountsSection
    {accountNpub}
    {evmAddress}
    showSquadList={true}
    {evmAccountList}
    {accountsLoading}
    onEditAccount={openEditAccountModal}
    onAddSquad={openAddAccountModal}
  />
{/if}

{#if accountFormMode}
  <SettingsFormModal
    titleId="account-form-title"
    title={accountFormMode === 'add' ? $t('wallet.addNewAccount') : $t('wallet.editSquadAccount')}
    busy={accountFormBusy}
    primaryLabel={accountFormMode === 'add' ? $t('wallet.addAccount') : $t('wallet.save')}
    primaryBusyLabel={accountFormMode === 'add' ? $t('wallet.adding') : $t('wallet.saving')}
    cancelLabel={$t('wallet.cancel')}
    onClose={closeAccountFormModal}
    onPrimary={submitAccountForm}
  >
    <label class="ui-field" for="account-form-name">
      <span class="ui-field-label">{$t('wallet.nameLabel')}</span>
      <input
        id="account-form-name"
        type="text"
        class="ui-input"
        maxlength={walletAccountLabelMaxLength}
        placeholder={$t('wallet.accountNamePlaceholder')}
        bind:value={accountFormLabel}
        disabled={accountFormBusy}
      />
    </label>
  </SettingsFormModal>
{/if}
