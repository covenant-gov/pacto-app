<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  const tFn = get(t);
  import {
    setActiveEvmAccount,
    setDefaultSharedEvmAccount,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { showToast } from '../../stores/toast';
  import EditIconButton from '../ui/EditIconButton.svelte';
  import { shortEvmAddress } from '../../lib/governance/hats-tree-annotations';
  import SettingsFormModal from './SettingsFormModal.svelte';

  interface Props {
    accountNpub: string;
    squadAccounts?: EvmAccountRow[];
    accountsLoading?: boolean;
    onSaved?: () => void | Promise<void>;
  }

  let { accountNpub, squadAccounts = [], accountsLoading = false, onSaved = () => {} }: Props = $props();

  let editOpen = $state(false);
  let saving = $state(false);

  let editSignerId = $state('');
  let editReceiverId = $state('');

  let activeSigner = $derived(squadAccounts.find((a) => a.isActive) ?? null);
  let activeReceiver = $derived(squadAccounts.find((a) => a.isDefaultShared) ?? null);
  let signerAddress = $derived(activeSigner?.address?.trim() || null);
  let receiverAddress = $derived(activeReceiver?.address?.trim() || signerAddress || null);

  function shortAddr(a: string | null): string {
    if (!a) return tFn('wallet.notSet');
    return shortEvmAddress(a);
  }

  function openEdit() {
    editSignerId = activeSigner?.id ?? squadAccounts[0]?.id ?? '';
    editReceiverId = activeReceiver?.id ?? activeSigner?.id ?? squadAccounts[0]?.id ?? '';
    editOpen = true;
  }

  function closeEdit() {
    if (saving) return;
    editOpen = false;
  }

  async function saveEdit() {
    if (saving || !accountNpub) return;
    if (!editSignerId || !editReceiverId) {
      showToast(tFn('wallet.chooseSignerAndReceiver'));
      return;
    }

    saving = true;
    let receiverChanged = false;
    try {
      if (editSignerId !== activeSigner?.id) {
        await setActiveEvmAccount(editSignerId);
      }
      if (editReceiverId !== activeReceiver?.id) {
        await setDefaultSharedEvmAccount(editReceiverId);
        receiverChanged = true;
      }
      editOpen = false;
      await onSaved();
      showToast(
        receiverChanged
          ? tFn('wallet.receivingAddressSaved')
          : tFn('wallet.walletConfigSaved'),
      );
    } catch (e) {
      showToast(getInvokeErrorMessage(e, tFn('wallet.couldNotSaveWalletConfig')));
    } finally {
      saving = false;
    }
  }

  function accountOptionLabel(acc: EvmAccountRow): string {
    const parts: string[] = [shortAddr(acc.address)];
    if (acc.label?.trim()) parts.push(acc.label.trim());
    return parts.join(' · ');
  }
</script>

<section class="dwc" aria-labelledby="wallet-default-evm-heading">
  <h2 id="wallet-default-evm-heading" class="dwc-title">{$t('wallet.defaultEvmAccountTitle')}</h2>

  <div class="dwc-summary">
    <dl class="dwc-summary-list">
      <div class="dwc-summary-row">
        <dt>{$t('wallet.signerLabel')}</dt>
        <dd><code>{shortAddr(signerAddress)}</code></dd>
      </div>
      <div class="dwc-summary-row">
        <dt>{$t('wallet.receiverLabel')}</dt>
        <dd><code>{shortAddr(receiverAddress)}</code></dd>
      </div>
    </dl>
    <EditIconButton
      disabled={accountsLoading || squadAccounts.length === 0}
      ariaLabel={$t('wallet.editDefaultEvmAccount')}
      title={$t('wallet.editDefaultEvmAccount')}
      className="dwc-summary-edit"
      onclick={openEdit}
    />
  </div>

  {#if squadAccounts.length === 0 && !accountsLoading}
    <p class="dwc-hint dwc-hint-tight">{$t('wallet.addSquadAccountFirst')}</p>
  {/if}
</section>

{#if editOpen}
  <SettingsFormModal
    titleId="wallet-default-evm-edit-title"
    title={$t('wallet.editDefaultEvmAccountTitle')}
    busy={saving}
    primaryLabel={$t('wallet.save')}
    primaryBusyLabel={$t('wallet.saving')}
    cancelLabel={$t('wallet.cancel')}
    primaryDisabled={squadAccounts.length === 0}
    onClose={closeEdit}
    onPrimary={saveEdit}
  >
    <label class="settings-form-field" for="wallet-default-signer">
      <span class="settings-form-label">{$t('wallet.signerLabel')}</span>
      <select
        id="wallet-default-signer"
        class="settings-form-select"
        bind:value={editSignerId}
        disabled={saving || squadAccounts.length === 0}
      >
        {#each squadAccounts as acc (acc.id)}
          <option value={acc.id}>{accountOptionLabel(acc)}</option>
        {/each}
      </select>
    </label>
    <label class="settings-form-field" for="wallet-default-receiver">
      <span class="settings-form-label">{$t('wallet.receiverLabel')}</span>
      <select
        id="wallet-default-receiver"
        class="settings-form-select"
        bind:value={editReceiverId}
        disabled={saving || squadAccounts.length === 0}
      >
        {#each squadAccounts as acc (acc.id)}
          <option value={acc.id}>{accountOptionLabel(acc)}</option>
        {/each}
      </select>
    </label>
  </SettingsFormModal>
{/if}

<style>
  .dwc {
    margin-bottom: 8px;
  }

  .dwc-title {
    margin: 0 0 8px;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .dwc-hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  .dwc-hint-tight {
    margin-top: 12px;
  }

  .dwc-summary {
    margin: 16px 0 0 0;
    padding: 16px 18px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-elevated);
    display: grid;
    grid-template-columns: minmax(120px, 34%) 1fr auto;
    column-gap: 12px;
    row-gap: 12px;
    align-items: center;
  }

  .dwc-summary-list {
    margin: 0;
    display: contents;
  }

  .dwc-summary-row {
    display: contents;
  }

  :global(.dwc-summary-edit) {
    grid-column: 3;
    grid-row: 1 / span 2;
    align-self: start;
    justify-self: end;
    width: 2rem;
    height: 2rem;
    border-color: var(--border);
    background: var(--bg-hover);
    color: var(--text-primary);
    transition: border-color 0.2s;
  }

  :global(.dwc-summary-edit:hover:not(:disabled)) {
    border-color: var(--brand);
  }

  :global(.dwc-summary-edit:disabled) {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .dwc-summary-row dt {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .dwc-summary-row dd {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-primary);
    word-break: break-all;
  }

  .dwc-summary-row dd code {
    font-family: ui-monospace, 'Courier New', monospace;
    font-size: 0.875rem;
  }

</style>
