<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import Modal from '../../ui/Modal.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { resolveSquadRosterEvmAddress } from '../../../lib/squad/squad-roster-binding';
  import { startPactoGovDeploy, type PactoGovDeployComplete } from '../../../lib/governance/start-pacto-gov-deploy';
  import type { PactoGovCaptainOption } from '../../../lib/governance/start-pacto-gov-deploy';
  import { getAddress, isAddress } from 'viem';

  export let parentId: string;
  export let squadNetwork: SupportedChainId | null = null;
  /** Kept for parent wiring; captain is always the deployer's roster EVM. */
  export let captainMemberOptions: PactoGovCaptainOption[] = [];
  export let onClose: () => void;
  export let onComplete: (out: PactoGovDeployComplete) => void | Promise<void>;

  const titleId = 'deploy-pacto-gov-title';
  const descId = 'deploy-pacto-gov-desc';

  const tFn = get(t);

  let captainAddress = '';
  let resolvingDeployer = true;
  let deployError = '';

  function shortAddress(addr: string): string {
    if (addr.length < 18) return addr;
    return `${addr.slice(0, 10)}…${addr.slice(-8)}`;
  }

  onMount(async () => {
    resolvingDeployer = true;
    captainAddress = '';
    try {
      const raw = await resolveSquadRosterEvmAddress(parentId.trim());
      if (raw?.trim() && isAddress(raw.trim() as `0x${string}`)) {
        captainAddress = getAddress(raw.trim() as `0x${string}`);
      }
    } catch {
      captainAddress = '';
    } finally {
      resolvingDeployer = false;
    }
  });

  function executeDeploy() {
    deployError = '';
    if (!squadNetwork) {
      deployError = tFn('governance.deployPactoGov.error.noNetwork');
      return;
    }
    if (resolvingDeployer) {
      deployError = tFn('governance.deployPactoGov.error.loadingEvm');
      return;
    }
    if (!captainAddress) {
      deployError = tFn('governance.deployPactoGov.error.noBoundEvm');
      return;
    }
    startPactoGovDeploy({
      parentId: parentId.trim(),
      squadNetwork,
      captain: captainAddress,
      onReject: (message) => {
        deployError = message;
      },
      onError: (message) => {
        deployError = message;
      },
      onComplete: async (out) => {
        await onComplete(out);
        onClose();
      },
    });
  }
</script>

<Modal {titleId} descriptionId={descId} {onClose} dismissible contentClass="deploy-pacto-gov-panel">
  <h2 id={titleId}>{$t('governance.deployPactoGov.title')}</h2>
  <p id={descId} class="pacto-gov-deploy-desc">
    {$t('governance.deployPactoGov.description')}
  </p>

  <div class="pacto-gov-deploy-field">
    <span class="pacto-gov-deploy-label">{$t('governance.deployPactoGov.squadNetworkLabel')}</span>
    {#if squadNetwork}
      <p class="pacto-gov-deploy-pinned">
        {getWalletNetworkDisplayName(squadNetwork)}
        <span class="pacto-gov-deploy-pinned-note">{$t('governance.common.changeInSettings')}</span>
      </p>
    {:else}
      <p class="pacto-gov-deploy-pinned pacto-gov-deploy-pinned--warn">
        {$t('governance.deployPactoGov.networkNotSet')}
      </p>
    {/if}
  </div>

  <div class="pacto-gov-deploy-field">
    <span class="pacto-gov-deploy-label">{$t('governance.deployPactoGov.captainLabel')}</span>
    {#if resolvingDeployer}
      <p class="pacto-gov-deploy-hint muted">{$t('governance.common.loadingSquadAssignedEvm')}</p>
    {:else if captainAddress}
      <p class="pacto-gov-deploy-pinned">
        <code>{shortAddress(captainAddress)}</code>
        <span class="pacto-gov-deploy-pinned-note">{$t('governance.common.yourSquadAssignedEvm')}</span>
      </p>
    {:else}
      <p class="pacto-gov-deploy-hint muted">
        {$t('governance.deployPactoGov.captainNoEvmHint')}
        {#if captainMemberOptions.length === 0}
          {$t('governance.deployPactoGov.captainDashboardHint')}
        {/if}
      </p>
    {/if}
  </div>

  {#if deployError}
    <p class="input-error" role="alert">{deployError}</p>
  {/if}

  <div class="modal-actions">
    <button type="button" class="btn-secondary" onclick={onClose}>{$t('governance.common.cancel')}</button>
    <button
      type="button"
      class="btn-primary"
      disabled={!squadNetwork || resolvingDeployer || !captainAddress}
      onclick={executeDeploy}
    >
      {$t('governance.common.execute')}
    </button>
  </div>
</Modal>

<style>
  .pacto-gov-deploy-desc {
    margin: 0 0 16px;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 52ch;
  }
  .pacto-gov-deploy-field {
    margin-bottom: 14px;
  }
  .pacto-gov-deploy-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
    margin-bottom: 6px;
  }
  .pacto-gov-deploy-pinned {
    margin: 0;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated, var(--bg-panel));
    color: var(--text-primary);
    font-size: 0.9375rem;
  }
  .pacto-gov-deploy-pinned--warn {
    color: var(--text-secondary);
  }
  .pacto-gov-deploy-pinned-note {
    color: var(--text-muted);
    font-size: 0.8125rem;
  }
  .pacto-gov-deploy-hint {
    margin: 6px 0 0;
    font-size: 0.8125rem;
    line-height: 1.4;
  }
  .muted {
    color: var(--text-muted);
  }
  .input-error {
    margin: 0 0 12px;
    font-size: 0.875rem;
    color: var(--danger, #c44);
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }
</style>
