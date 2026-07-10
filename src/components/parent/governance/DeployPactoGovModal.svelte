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
  /** Squad members who shared an EVM address on #announcements. */
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

  function pickDefaultCaptain(deployer: string | null) {
    if (captainAddress) return;
    const opts = captainMemberOptions;
    if (deployer) {
      const match = opts.find((o) => o.address.toLowerCase() === deployer.toLowerCase());
      if (match) {
        captainAddress = match.address;
        return;
      }
    }
    if (opts.length > 0) captainAddress = opts[0].address;
  }

  onMount(async () => {
    resolvingDeployer = true;
    let deployer: string | null = null;
    try {
      const raw = await resolveSquadRosterEvmAddress(parentId.trim());
      if (raw?.trim() && isAddress(raw.trim() as `0x${string}`)) {
        deployer = getAddress(raw.trim() as `0x${string}`);
      }
    } catch {
      // fall through to member list default
    } finally {
      resolvingDeployer = false;
    }
    pickDefaultCaptain(deployer);
  });

  $: if (!resolvingDeployer && !captainAddress && captainMemberOptions.length > 0) {
    pickDefaultCaptain(null);
  }

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
      deployError = 'Pick a captain with a shared squad EVM address.';
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
    Deploy the Nave Pirata factory bundle on the squad network. Gas is paid from your squad-assigned EVM address;
    the captain receives on-chain governance authority.
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
    <label class="pacto-gov-deploy-label" for="pacto-gov-captain">Captain</label>
    {#if captainMemberOptions.length === 0}
      <p class="pacto-gov-deploy-hint muted">
        No squad members have shared an EVM address yet. Members share addresses in Settings or via the roster prompt in
        #personal-alerts.
      </p>
    {:else}
      <select
        id="pacto-gov-captain"
        class="pacto-gov-deploy-select"
        bind:value={captainAddress}
        disabled={resolvingDeployer}
      >
        {#each captainMemberOptions as opt (opt.npub)}
          <option value={opt.address}>{opt.label} — {shortAddress(opt.address)}</option>
        {/each}
      </select>
      <p class="pacto-gov-deploy-hint muted">
        {#if resolvingDeployer}
          Defaulting to your squad address…
        {:else}
          Defaults to you as deployer. Pick any member who has shared a squad EVM address.
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
      disabled={!squadNetwork || resolvingDeployer || captainMemberOptions.length === 0 || !captainAddress}
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
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin: 0 0 6px;
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

  .pacto-gov-deploy-select {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .pacto-gov-deploy-hint {
    margin: 6px 0 0;
    font-size: 0.8125rem;
    line-height: 1.4;
  }
</style>
