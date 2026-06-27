<script lang="ts">
  import Modal from '../../ui/Modal.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import {
    squadAdminCreateRole,
    squadAdminEnableExecutor,
    squadAdminEnableFullPermission,
  } from '../../../lib/governance/api';
  import { runOnChainInBackground } from '../../../lib/evm/on-chain-background';
  import { showToast } from '../../../stores/toast';

  export let open = false;
  export let onClose: () => void;
  export let squadAdminProxy: string;
  export let network: SupportedChainId = 'sepolia';
  /** EVM address → display label for executor picker. */
  export let memberEvmOptions: { address: string; label: string }[] = [];

  const titleId = 'squad-roles-modal-title';
  const descId = 'squad-roles-modal-desc';

  let roleLabel = '';
  let executorAddress = '';
  let grantFullPermission = false;
  let actionError = '';

  $: if (open && !executorAddress && memberEvmOptions.length > 0) {
    executorAddress = memberEvmOptions[0].address;
  }

  function resetForm() {
    roleLabel = '';
    actionError = '';
    grantFullPermission = false;
  }

  function runAction(fn: () => Promise<unknown>, successMessage: string) {
    actionError = '';
    runOnChainInBackground({
      startedToast: 'Transaction submitted. Confirmation continues in the background.',
      job: fn,
      onSuccess: async () => {
        showToast(successMessage);
        resetForm();
      },
      onError: (message) => {
        actionError = message;
      },
    });
  }

  async function createRole() {
    const label = roleLabel.trim();
    if (!label) {
      actionError = 'Enter a role label (max 32 ASCII characters).';
      return;
    }
    await runAction(
      () =>
        squadAdminCreateRole({
          network,
          squadAdminProxy,
          roleLabel: label,
        }),
      `Role "${label}" registered on-chain.`,
    );
  }

  async function enableExecutor() {
    const label = roleLabel.trim();
    const exec = executorAddress.trim();
    if (!label) {
      actionError = 'Enter the role label to enable.';
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(exec)) {
      actionError = 'Pick or enter a valid executor address.';
      return;
    }
    await runAction(
      () =>
        squadAdminEnableExecutor({
          network,
          squadAdminProxy,
          executorAddress: exec,
          roleLabel: label,
        }),
      `Executor enabled for role "${label}".`,
    );
  }

  async function enableFull() {
    const exec = executorAddress.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(exec)) {
      actionError = 'Pick or enter a valid executor address.';
      return;
    }
    await runAction(
      () =>
        squadAdminEnableFullPermission({
          network,
          squadAdminProxy,
          executorAddress: exec,
          enable: grantFullPermission,
        }),
      grantFullPermission ? 'Full permission granted.' : 'Full permission revoked.',
    );
  }
</script>

{#if open}
  <Modal {titleId} descriptionId={descId} {onClose} dismissible contentClass="squad-roles-modal-panel">
    <h2 id={titleId}>Squad Admin roles</h2>
    <p id={descId} class="squad-roles-modal-desc">
      Register app roles and assign executors on <code>{squadAdminProxy}</code>. Role labels are left-padded bytes32
      keys (for example <code>TREASURY</code> or <code>SETTINGS</code>).
    </p>

    <div class="squad-roles-field">
      <label class="squad-roles-label" for="squad-role-label">Role label</label>
      <input
        id="squad-role-label"
        type="text"
        class="squad-roles-input"
        placeholder="e.g. TREASURY"
        bind:value={roleLabel}
        maxlength="32"
        autocomplete="off"
      />
    </div>

    <div class="squad-roles-field">
      <label class="squad-roles-label" for="squad-role-executor">Executor address</label>
      {#if memberEvmOptions.length > 0}
        <select
          id="squad-role-executor"
          class="squad-roles-input"
          bind:value={executorAddress}
        >
          {#each memberEvmOptions as opt (opt.address)}
            <option value={opt.address}>{opt.label} — {opt.address}</option>
          {/each}
        </select>
      {:else}
        <input
          id="squad-role-executor"
          type="text"
          class="squad-roles-input"
          placeholder="0x…"
          bind:value={executorAddress}
          autocomplete="off"
        />
      {/if}
    </div>

    {#if actionError}
      <p class="input-error" role="alert">{actionError}</p>
    {/if}

    <div class="squad-roles-actions">
      <button type="button" class="btn-secondary" on:click={createRole}>
        Create role
      </button>
      <button type="button" class="btn-secondary" on:click={enableExecutor}>
        Enable executor
      </button>
    </div>

    <div class="squad-roles-full-row">
      <label class="squad-roles-check">
        <input type="checkbox" bind:checked={grantFullPermission} />
        Grant FULL sentinel (all roles)
      </label>
      <button type="button" class="btn-secondary" on:click={enableFull}>
        Apply FULL
      </button>
    </div>

    <div class="squad-roles-modal-actions">
      <button type="button" class="btn-primary" on:click={onClose}>Close</button>
    </div>
  </Modal>
{/if}

<style>
  :global(.squad-roles-modal-panel) {
    max-width: 480px;
  }

  .squad-roles-modal-desc {
    font-size: 0.875rem;
    line-height: 1.5;
    margin: 0 0 12px 0;
    color: var(--text-secondary);
  }

  .squad-roles-field {
    margin-bottom: 12px;
  }

  .squad-roles-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
    margin-bottom: 6px;
  }

  .squad-roles-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .squad-roles-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0;
  }

  .squad-roles-full-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    font-size: 0.875rem;
  }

  .squad-roles-check {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .squad-roles-modal-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
  }
</style>
