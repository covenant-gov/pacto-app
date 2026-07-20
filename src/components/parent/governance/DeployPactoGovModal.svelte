<script lang="ts">
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
      deployError = 'Set the squad network in Settings before deploying.';
      return;
    }
    if (resolvingDeployer) {
      deployError = 'Loading your squad EVM address…';
      return;
    }
    if (!captainAddress) {
      deployError = 'Bind a squad-assigned EVM before deploying — you become captain.';
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
  <h2 id={titleId}>Deploy Pacto Gov</h2>
  <p id={descId} class="pacto-gov-deploy-desc">
    Deploy the Nave Pirata factory bundle on the squad network. You become captain on your squad-assigned EVM;
    gas is paid from that key.
  </p>

  <div class="pacto-gov-deploy-field">
    <span class="pacto-gov-deploy-label">Squad network</span>
    {#if squadNetwork}
      <p class="pacto-gov-deploy-pinned">
        {getWalletNetworkDisplayName(squadNetwork)}
        <span class="pacto-gov-deploy-pinned-note">· change in Settings</span>
      </p>
    {:else}
      <p class="pacto-gov-deploy-pinned pacto-gov-deploy-pinned--warn">
        Not set — choose a network in Settings before deploying.
      </p>
    {/if}
  </div>

  <div class="pacto-gov-deploy-field">
    <span class="pacto-gov-deploy-label">Captain</span>
    {#if resolvingDeployer}
      <p class="pacto-gov-deploy-hint muted">Loading your squad-assigned EVM…</p>
    {:else if captainAddress}
      <p class="pacto-gov-deploy-pinned">
        <code>{shortAddress(captainAddress)}</code>
        <span class="pacto-gov-deploy-pinned-note">· your squad-assigned EVM</span>
      </p>
    {:else}
      <p class="pacto-gov-deploy-hint muted">
        Bind a squad-assigned EVM for this squad before deploying.
        {#if captainMemberOptions.length === 0}
          Members share addresses in My Dashboard or via the roster prompt in #my-dashboard Alerts.
        {/if}
      </p>
    {/if}
  </div>

  {#if deployError}
    <p class="input-error" role="alert">{deployError}</p>
  {/if}

  <div class="modal-actions">
    <button type="button" class="btn-secondary" on:click={onClose}>Cancel</button>
    <button
      type="button"
      class="btn-primary"
      disabled={!squadNetwork || resolvingDeployer || !captainAddress}
      on:click={executeDeploy}
    >
      Execute
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
