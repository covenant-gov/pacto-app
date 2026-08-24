<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import Modal from '../../ui/Modal.svelte';
  import {
    getSquadSponsorWithdrawable,
    withdrawSquadSponsor,
  } from '../../../lib/governance/api';
  import {
    evmAccountPurposeLabel,
    evmAccountSchemeLabel,
    listEvmAccounts,
    type EvmAccountRow,
  } from '../../../lib/wallet/evm-accounts';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { runOnChainInBackground } from '../../../lib/evm/on-chain-background';
  import { hasPendingJob } from '../../../stores/pending-on-chain';
  import { showToast } from '../../../stores/toast';
  import { formatEther } from 'viem';
  import { shortEvmAddress } from '../../../lib/governance/hats-tree-annotations';

  interface Props {
    open?: boolean;
    onClose?: () => void;
    network?: string;
    parentId?: string;
    sponsorAddress?: string;
    onSubmitted?: () => void;
  }

  let {
    open = false,
    onClose = () => {},
    network = 'sepolia',
    parentId = '',
    sponsorAddress = '',
    onSubmitted = () => {},
  }: Props = $props();

  const titleId = 'sponsor-withdraw-title';
  const descId = 'sponsor-withdraw-desc';

  const tFn = get(t);

  let accounts = $state<EvmAccountRow[]>([]);
  let accountsLoading = $state(false);
  let selectedAccountId = $state('');
  let withdrawableWei = $state<string | null>(null);
  let withdrawableLoading = $state(false);
  let error = $state('');
  let wasOpen = $state(false);

  const selected = $derived(accounts.find((a) => a.id === selectedAccountId) ?? null);
  let lastWithdrawableKey = $state('');

  $effect(() => {
    if (open && !wasOpen) {
      wasOpen = true;
      error = '';
      withdrawableWei = null;
      selectedAccountId = '';
      lastWithdrawableKey = '';
      void loadAccounts();
    }
  });
  $effect(() => {
    if (!open) {
      wasOpen = false;
    }
  });

  const withdrawableKey = $derived(
    open && selected?.address
      ? `${parentId.trim()}|${selected.address.trim().toLowerCase()}|${sponsorAddress.trim().toLowerCase()}`
      : '',
  );
  $effect(() => {
    if (withdrawableKey && withdrawableKey !== lastWithdrawableKey) {
      lastWithdrawableKey = withdrawableKey;
      if (selected) {
        void loadWithdrawable(selected.address);
      }
    }
  });

  async function loadAccounts() {
    accountsLoading = true;
    try {
      accounts = (await listEvmAccounts()) ?? [];
      if (accounts.length > 0 && !selectedAccountId) {
        const preferred =
          accounts.find((a) => a.isDefaultShared) ??
          accounts.find((a) => a.isActive) ??
          accounts[0];
        selectedAccountId = preferred.id;
      }
    } catch (e) {
      error = getInvokeErrorMessage(e, tFn('governance.withdraw.error.loadKeys'));
      accounts = [];
    } finally {
      accountsLoading = false;
    }
  }

  async function loadWithdrawable(address: string) {
    if (!parentId.trim() || !address.trim()) {
      withdrawableWei = null;
      return;
    }
    withdrawableLoading = true;
    try {
      withdrawableWei = await getSquadSponsorWithdrawable({
        network,
        parentId: parentId.trim(),
        accountAddress: address,
        sponsorAddress: sponsorAddress.trim() || null,
      });
    } catch {
      withdrawableWei = null;
    } finally {
      withdrawableLoading = false;
    }
  }

  function optionLabel(acc: EvmAccountRow): string {
    const name = acc.label?.trim() || (acc.isDefaultShared ? tFn('governance.withdraw.accountDefault') : tFn('governance.withdraw.accountUnnamed'));
    const short = shortEvmAddress(acc.address);
    return `${name} · ${short} (${tFn(evmAccountPurposeLabel(acc.purpose))}, ${tFn(evmAccountSchemeLabel(acc.scheme))})`;
  }

  function submit() {
    if (!selectedAccountId || hasPendingJob(parentId.trim(), 'sponsor-withdraw')) return;
    error = '';
    const accountId = selectedAccountId;
    onClose();
    runOnChainInBackground({
      jobLabel: tFn('governance.withdraw.title'),
      parentId: parentId.trim(),
      actionKey: 'sponsor-withdraw',
      startedToast: tFn('governance.toast.squadTransactionSubmitted'),
      job: () =>
        withdrawSquadSponsor({
          network,
          parentId: parentId.trim(),
          accountId,
          sponsorAddress: sponsorAddress.trim() || null,
        }),
      onSuccess: () => {
        showToast(tFn('governance.withdraw.toast.confirmed'));
        onSubmitted();
      },
    });
  }
</script>

{#if open}
  <Modal {titleId} descriptionId={descId} onClose={onClose} dismissible contentClass="sponsor-withdraw-modal">
    <h2 id={titleId} class="modal-title">{$t('governance.withdraw.title')}</h2>
    <p id={descId} class="modal-lead muted">
      {$t('governance.withdraw.description')}
    </p>

    <label class="field-label" for="sponsor-withdraw-account">{$t('governance.withdraw.accountLabel')}</label>
    {#if accountsLoading}
      <p class="muted">{$t('governance.common.loadingKeys')}</p>
    {:else if accounts.length === 0}
      <p class="err" role="alert">{$t('governance.withdraw.noKeys')}</p>
    {:else}
      <select
        id="sponsor-withdraw-account"
        class="account-select"
        bind:value={selectedAccountId}
      >
        {#each accounts as acc (acc.id)}
          <option value={acc.id}>{optionLabel(acc)}</option>
        {/each}
      </select>
    {/if}

    {#if selected}
      <p class="withdrawable muted" aria-live="polite">
        {#if withdrawableLoading}
          {$t('governance.withdraw.withdrawableLoading')}
        {:else if withdrawableWei != null}
          <strong>
            {$t('governance.withdraw.withdrawableAmount', { values: { amount: formatEther(BigInt(withdrawableWei)) } })}
          </strong>
        {:else}
          {$t('governance.withdraw.withdrawableUnavailable')}
        {/if}
      </p>
    {/if}

    {#if error}
      <p class="err" role="alert">{error}</p>
    {/if}

    <div class="modal-actions">
      <button type="button" class="btn-secondary" onclick={onClose}>{$t('governance.common.cancel')}</button>
      <button
        type="button"
        class="btn-primary"
        disabled={!selectedAccountId || accounts.length === 0}
        onclick={submit}
      >
        {$t('governance.withdraw.action.confirm')}
      </button>
    </div>
  </Modal>
{/if}

<style>
  :global(.sponsor-withdraw-modal) {
    max-width: 28rem;
  }
  .modal-title {
    margin: 0 0 8px;
    font-size: 1.0625rem;
    font-weight: 600;
  }
  .modal-lead {
    margin: 0 0 14px;
    font-size: 0.8125rem;
    line-height: 1.45;
  }
  .field-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
    margin-bottom: 6px;
  }
  .account-select {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.8125rem;
    margin-bottom: 8px;
  }
  .withdrawable {
    margin: 0 0 12px;
    font-size: 0.8125rem;
  }
  .modal-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
  }
  .muted {
    color: var(--text-muted);
  }
  .err {
    margin: 0 0 10px;
    font-size: 0.8125rem;
    color: var(--danger, #e53e3e);
  }
  .btn-primary,
  .btn-secondary {
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .btn-primary {
    background: var(--brand);
    color: var(--on-brand);
    border: none;
  }
  .btn-secondary {
    background: var(--bg-elevated);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
  .btn-primary:disabled,
  .btn-secondary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
