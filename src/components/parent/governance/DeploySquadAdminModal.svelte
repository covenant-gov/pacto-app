<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import Modal from '../../ui/Modal.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { deploySquadAdminForParent } from '../../../lib/governance/api';
  import { runOnChainInBackground } from '../../../lib/evm/on-chain-background';
  import SquadDeployNetworkField from './SquadDeployNetworkField.svelte';

  export let parentId: string;
  /** When set, deploy uses captain_hat variant with this hat id. */
  export let captainHatId: string | null = null;
  /** Established squad network; when set the picker is pinned to it. */
  export let squadNetwork: SupportedChainId | null = null;
  export let onClose: () => void;
  export let onComplete: (result: {
    txHash: string;
    chain: string;
    squadAdminProxy: string;
    providerPayload: string;
    infraRowId: string;
  }) => Promise<void>;

  const titleId = 'deploy-squad-admin-title';
  const descId = 'deploy-squad-admin-desc';

  const tFn = get(t);

  let deployNetwork: SupportedChainId | '' = squadNetwork ?? '';
  let deployError = '';

  $: variant = captainHatId?.trim() ? ('captain_hat' as const) : ('ext_standalone' as const);

  async function confirmDeploy() {
    deployError = '';
    if (!deployNetwork) {
      deployError = tFn('governance.deploySquadAdmin.error.noNetwork');
      return;
    }
    const jobParams = {
      network: deployNetwork,
      parentId: parentId.trim(),
      variant,
      captainHatId: captainHatId?.trim() || null,
    };
    onClose();
    runOnChainInBackground({
      startedToast: tFn('governance.deploySquadAdmin.toast.submitted'),
      subject: tFn('governance.deploySquadAdmin.subject'),
      job: () => deploySquadAdminForParent(jobParams),
      onSuccess: async (result) => {
        await onComplete({
          txHash: result.txHash,
          chain: result.chain,
          squadAdminProxy: result.squadAdminProxy,
          providerPayload: result.providerPayload,
          infraRowId: result.infraRowId,
        });
      },
    });
  }
</script>

<Modal {titleId} descriptionId={descId} {onClose} dismissible contentClass="deploy-squad-admin-panel">
  <h2 id={titleId}>{$t('governance.deploySquadAdmin.title')}</h2>
  <p id={descId} class="squad-admin-deploy-desc">
    {#if variant === 'captain_hat'}
      {$t('governance.deploySquadAdmin.description.captainHat', { values: { hatId: captainHatId } })}
    {:else}
      {$t('governance.deploySquadAdmin.description.extStandalone')}
    {/if}
    {$t('governance.deploySquadAdmin.gasNote')}
  </p>

  <div class="squad-admin-deploy-field">
    <SquadDeployNetworkField
      id="squad-admin-deploy-network"
      {squadNetwork}
      bind:value={deployNetwork}
      labelClass="squad-admin-deploy-label"
      selectClass="squad-admin-deploy-input squad-admin-deploy-select"
    />
  </div>

  {#if deployError}
    <p class="input-error" role="alert">{deployError}</p>
  {/if}

  <div class="modal-actions">
    <button type="button" class="btn-secondary" on:click={onClose}>{$t('governance.common.cancel')}</button>
    <button type="button" class="btn-primary" on:click={confirmDeploy}>
      {$t('governance.common.deployOnChain')}
    </button>
  </div>
</Modal>

<style>
  .squad-admin-deploy-desc {
    margin: 0 0 16px;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 52ch;
  }

  .squad-admin-deploy-field {
    margin-bottom: 14px;
  }

</style>
