<script lang="ts">
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
  import { parseWalletOpError } from '../../../lib/wallet/backend-wallet';
  import { showToast } from '../../../stores/toast';
  import { formatEther } from 'viem';

  export let open = false;
  export let onClose: () => void = () => {};
  export let network = 'sepolia';
  export let parentId = '';
  export let sponsorAddress = '';
  export let onSubmitted: () => void = () => {};

  const titleId = 'sponsor-withdraw-title';
  const descId = 'sponsor-withdraw-desc';

  let accounts: EvmAccountRow[] = [];
  let accountsLoading = false;
  let selectedAccountId = '';
  let withdrawableWei: string | null = null;
  let withdrawableLoading = false;
  let acting = false;
  let error = '';
  let wasOpen = false;

  $: selected = accounts.find((a) => a.id === selectedAccountId) ?? null;
  let lastWithdrawableKey = '';

  $: if (open && !wasOpen) {
    wasOpen = true;
    error = '';
    withdrawableWei = null;
    selectedAccountId = '';
    lastWithdrawableKey = '';
    void loadAccounts();
  }
  $: if (!open) {
    wasOpen = false;
  }

  $: withdrawableKey =
    open && selected?.address
      ? `${parentId.trim()}|${selected.address.trim().toLowerCase()}|${sponsorAddress.trim().toLowerCase()}`
      : '';
  $: if (withdrawableKey && withdrawableKey !== lastWithdrawableKey) {
    lastWithdrawableKey = withdrawableKey;
    if (selected) {
      void loadWithdrawable(selected.address);
    }
  }

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
      error = getInvokeErrorMessage(e, 'Could not load EVM keys.');
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
    const name = acc.label?.trim() || (acc.isDefaultShared ? 'Default' : 'Unnamed');
    const short = `${acc.address.slice(0, 6)}…${acc.address.slice(-4)}`;
    return `${name} · ${short} (${evmAccountPurposeLabel(acc.purpose)}, ${evmAccountSchemeLabel(acc.scheme)})`;
  }

  async function submit() {
    if (acting || !selectedAccountId) return;
    acting = true;
    error = '';
    try {
      await withdrawSquadSponsor({
        network,
        parentId: parentId.trim(),
        accountId: selectedAccountId,
        sponsorAddress: sponsorAddress.trim() || null,
      });
      showToast('Sponsor pool withdraw confirmed.');
      onSubmitted();
      onClose();
    } catch (e) {
      let raw = getInvokeErrorMessage(e, 'Withdraw failed.');
      const parsed = parseWalletOpError(raw);
      if (parsed?.message) raw = parsed.message;
      error = raw;
    } finally {
      acting = false;
    }
  }
</script>

{#if open}
  <Modal {titleId} descriptionId={descId} onClose={onClose} dismissible={!acting} contentClass="sponsor-withdraw-modal">
    <h2 id={titleId} class="modal-title">Withdraw from sponsor pool</h2>
    <p id={descId} class="modal-lead muted">
      Choose the EVM key that deposited (holds sponsor shares). Withdraw burns that key’s shares and
      returns its pro-rata ETH. The selected key also pays gas, so it needs a little native balance.
    </p>

    <label class="field-label" for="sponsor-withdraw-account">Depositing key</label>
    {#if accountsLoading}
      <p class="muted">Loading keys…</p>
    {:else if accounts.length === 0}
      <p class="err" role="alert">No EVM keys found. Add one under Settings.</p>
    {:else}
      <select
        id="sponsor-withdraw-account"
        class="account-select"
        bind:value={selectedAccountId}
        disabled={acting}
      >
        {#each accounts as acc (acc.id)}
          <option value={acc.id}>{optionLabel(acc)}</option>
        {/each}
      </select>
    {/if}

    {#if selected}
      <p class="withdrawable muted" aria-live="polite">
        {#if withdrawableLoading}
          Withdrawable: …
        {:else if withdrawableWei != null}
          Withdrawable:
          <strong>
            {formatEther(BigInt(withdrawableWei))} ETH
          </strong>
        {:else}
          Withdrawable: unavailable
        {/if}
      </p>
    {/if}

    {#if error}
      <p class="err" role="alert">{error}</p>
    {/if}

    <div class="modal-actions">
      <button type="button" class="btn-secondary" disabled={acting} on:click={onClose}>Cancel</button>
      <button
        type="button"
        class="btn-primary"
        disabled={acting || !selectedAccountId || accounts.length === 0}
        on:click={submit}
      >
        {acting ? 'Withdrawing…' : 'Confirm withdraw'}
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
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    border: none;
  }
  .btn-secondary {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
  .btn-primary:disabled,
  .btn-secondary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
