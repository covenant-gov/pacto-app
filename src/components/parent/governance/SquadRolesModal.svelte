<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import Modal from '../../ui/Modal.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import {
    getSquadCapabilities,
    squadAdminCreateRole,
    squadAdminEnableExecutor,
    squadAdminEnableFullPermission,
  } from '../../../lib/governance/api';
  import {
    gateSquadAdminWrite,
    resolveGovernancePrivilege,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import { runOnChainInBackground } from '../../../lib/evm/on-chain-background';
  import { showToast } from '../../../stores/toast';
  import { appConfig } from '../../../stores/app-config';

  export let open = false;
  export let onClose: () => void;
  export let parentId = '';
  export let squadAdminProxy: string;
  export let network: SupportedChainId = 'sepolia';
  /** EVM address → display label for executor picker. */
  export let memberEvmOptions: { address: string; label: string }[] = [];
  export let privilege: GovernancePrivilege | null = null;

  const titleId = 'squad-roles-modal-title';
  const descId = 'squad-roles-modal-desc';

  const tFn = get(t);

  let roleLabel = '';
  let executorAddress = '';
  let grantFullPermission = false;
  let actionError = '';
  let loadedPrivilege: GovernancePrivilege | null = null;
  let privilegeLoadKey = '';

  $: roleLabelMaxLength = $appConfig.roleLabelMaxLength;

  $: effectivePrivilege = privilege ?? loadedPrivilege;
  $: saGate = effectivePrivilege
    ? gateSquadAdminWrite(effectivePrivilege)
    : ({ enabled: true, reason: '' } as const);

  $: if (open && !executorAddress && memberEvmOptions.length > 0) {
    executorAddress = memberEvmOptions[0].address;
  }

  $: if (open && parentId.trim()) {
    const pid = parentId.trim();
    const key = `${pid}|${network}`;
    if (key !== privilegeLoadKey) {
      privilegeLoadKey = key;
      void loadPrivilege(pid);
    }
  }

  async function loadPrivilege(pid: string) {
    const key = `${pid}|${network}`;
    try {
      const snap = await getSquadCapabilities(pid, network);
      if (!open || key !== privilegeLoadKey) return;
      loadedPrivilege = resolveGovernancePrivilege({
        myAddress: snap.rosterAddress,
        safeAddress: null,
        captainWearers: [],
        crewWearers: [],
        capabilities: snap,
      });
    } catch {
      if (!open || key !== privilegeLoadKey) return;
      loadedPrivilege = null;
    }
  }

  function resetForm() {
    roleLabel = '';
    actionError = '';
    grantFullPermission = false;
  }

  function runAction(fn: () => Promise<unknown>, successMessage: string) {
    actionError = '';
    runOnChainInBackground({
      startedToast: tFn('governance.squadRoles.toast.submitted'),
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
      actionError = tFn('governance.squadRoles.error.noRoleLabel', { values: { max: roleLabelMaxLength } });
      return;
    }
    if (!saGate.enabled) {
      actionError = saGate.reason;
      return;
    }
    await runAction(
      () =>
        squadAdminCreateRole({
          network,
          parentId,
          squadAdminProxy,
          roleLabel: label,
        }),
      tFn('governance.squadRoles.toast.roleCreated', { values: { label } }),
    );
  }

  async function enableExecutor() {
    const label = roleLabel.trim();
    const exec = executorAddress.trim();
    if (!label) {
      actionError = tFn('governance.squadRoles.error.noRoleToEnable');
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(exec)) {
      actionError = tFn('governance.squadRoles.error.invalidExecutor');
      return;
    }
    if (!saGate.enabled) {
      actionError = saGate.reason;
      return;
    }
    await runAction(
      () =>
        squadAdminEnableExecutor({
          network,
          parentId,
          squadAdminProxy,
          executorAddress: exec,
          roleLabel: label,
        }),
      tFn('governance.squadRoles.toast.executorEnabled', { values: { label } }),
    );
  }

  async function enableFull() {
    const exec = executorAddress.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(exec)) {
      actionError = tFn('governance.squadRoles.error.invalidExecutor');
      return;
    }
    if (!saGate.enabled) {
      actionError = saGate.reason;
      return;
    }
    await runAction(
      () =>
        squadAdminEnableFullPermission({
          network,
          parentId,
          squadAdminProxy,
          executorAddress: exec,
          enable: grantFullPermission,
        }),
      grantFullPermission ? tFn('governance.squadRoles.toast.fullGranted') : tFn('governance.squadRoles.toast.fullRevoked'),
    );
  }
</script>

{#if open}
  <Modal {titleId} descriptionId={descId} {onClose} dismissible contentClass="squad-roles-modal-panel">
    <h2 id={titleId}>{$t('governance.squadRoles.title')}</h2>
    <p id={descId} class="squad-roles-modal-desc">
      {$t('governance.squadRoles.description', { values: { proxy: squadAdminProxy } })}
    </p>
    {#if !saGate.enabled}
      <p class="input-error" role="status">{$t(saGate.reason)}</p>
    {/if}

    <div class="squad-roles-field">
      <label class="squad-roles-label" for="squad-role-label">{$t('governance.squadRoles.roleLabel')}</label>
      <input
        id="squad-role-label"
        type="text"
        class="squad-roles-input"
        placeholder={$t('governance.squadRoles.rolePlaceholder')}
        bind:value={roleLabel}
        maxlength={roleLabelMaxLength}
        autocomplete="off"
      />
    </div>

    <div class="squad-roles-field">
      <label class="squad-roles-label" for="squad-role-executor">{$t('governance.squadRoles.executorLabel')}</label>
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
          placeholder={$t('governance.squadRoles.executorPlaceholder')}
          bind:value={executorAddress}
          autocomplete="off"
        />
      {/if}
    </div>

    {#if actionError}
      <p class="input-error" role="alert">{$t(actionError)}</p>
    {/if}

    <div class="squad-roles-actions">
      <button type="button" class="btn-secondary" disabled={!saGate.enabled} onclick={createRole}>
        {$t('governance.squadRoles.action.createRole')}
      </button>
      <button type="button" class="btn-secondary" disabled={!saGate.enabled} onclick={enableExecutor}>
        {$t('governance.squadRoles.action.enableExecutor')}
      </button>
    </div>

    <div class="squad-roles-full-row">
      <label class="squad-roles-check">
        <input type="checkbox" bind:checked={grantFullPermission} disabled={!saGate.enabled} />
        {$t('governance.squadRoles.grantFull')}
      </label>
      <button type="button" class="btn-secondary" disabled={!saGate.enabled} onclick={enableFull}>
        {$t('governance.squadRoles.action.applyFull')}
      </button>
    </div>

    <div class="squad-roles-modal-actions">
      <button type="button" class="btn-primary" onclick={onClose}>{$t('governance.common.close')}</button>
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
