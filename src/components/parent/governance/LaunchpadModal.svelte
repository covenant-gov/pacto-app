<script lang="ts">
  import Modal from '../../ui/Modal.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';

  export let hasSponsor: boolean;
  export let hasPactoGov: boolean;
  export let hasSquadAdmin: boolean;
  export let vaultSafeCount = 0;
  export let hasAnnouncementsChannel: boolean;
  /** Established squad network; read-only here — change in Settings. */
  export let squadNetwork: SupportedChainId | null = null;
  /** Sponsor clone address when already deployed. */
  export let sponsorAddress = '';
  export let onClose: () => void;
  export let onDeploySponsor: () => void;
  export let onDeploySquadAdmin: () => void;
  export let onDeployPactoGov: () => void;
  export let onDeploySafe: () => void;
  export let onImportSafe: () => void;

  const titleId = 'launchpad-modal-title';
  const descId = 'launchpad-modal-desc';
  const networkNoteId = 'launchpad-squad-network-note';

  $: otherInfraLocked = !hasSponsor;
  $: channelBlocked = !hasAnnouncementsChannel;
</script>

<Modal {titleId} descriptionId={descId} {onClose} contentClass="launchpad-modal-panel">
  <h2 id={titleId}>Deploy infra</h2>
  <p id={descId} class="launchpad-desc">
    Choose on-chain infrastructure for this squad. Squad sponsor funds gas sponsorship and must be deployed first.
  </p>

  <section class="launchpad-squad-network" aria-labelledby="launchpad-squad-network-label">
    <span id="launchpad-squad-network-label" class="launchpad-squad-network-label">Squad network</span>
    {#if squadNetwork}
      <p class="launchpad-squad-network-value" aria-describedby={networkNoteId}>
        {getWalletNetworkDisplayName(squadNetwork)}
      </p>
      <p id={networkNoteId} class="launchpad-squad-network-note muted">
        All infra deploys to this network. Change it in Settings.
      </p>
    {:else}
      <p id={networkNoteId} class="launchpad-squad-network-note muted">
        Not set yet. Choose a network in Settings before deploying, or your first deploy will establish it.
      </p>
    {/if}
  </section>

  {#if channelBlocked}
    <p class="launchpad-channel-note muted" role="status">
      Add an #announcements channel before deploying or linking treasury infra.
    </p>
  {/if}

  <ul class="launchpad-grid" role="list">
    <li class="launchpad-card" class:launchpad-card--primary={!hasSponsor}>
      <h3 class="launchpad-card-title">Squad sponsor</h3>
      {#if hasSponsor}
        <div class="launchpad-deployed-status" role="status">
          <span class="launchpad-deployed-check" aria-hidden="true">✓</span>
          <div class="launchpad-deployed-body">
            <p class="launchpad-deployed-label">Deployed</p>
            {#if sponsorAddress}
              <code class="launchpad-deployed-addr">{sponsorAddress}</code>
            {/if}
            <p class="launchpad-card-desc">Top up balance from the Treasury tab.</p>
          </div>
        </div>
      {:else}
        <p class="launchpad-card-desc">Required first deploy — ERC-4337 gas pool for this squad.</p>
        <button
          type="button"
          class="btn-primary launchpad-card-btn"
          disabled={channelBlocked}
          on:click={() => {
            onClose();
            onDeploySponsor();
          }}
        >
          Deploy squad sponsor
        </button>
      {/if}
    </li>

    <li class="launchpad-card" class:launchpad-card--locked={otherInfraLocked}>
      <h3 class="launchpad-card-title">Pacto Gov</h3>
      <p class="launchpad-card-desc">
        {#if otherInfraLocked}
          Deploy squad sponsor first.
        {:else if hasPactoGov}
          Nave Pirata is deployed for this squad. Open the Governance and Roles Tree tabs to explore on-chain state.
        {:else}
          Nave Pirata factory bundle (Hats tree, treasury authority, Safe module).
        {/if}
      </p>
      <button
        type="button"
        class="btn-primary launchpad-card-btn"
        disabled={otherInfraLocked || channelBlocked}
        on:click={() => {
          onClose();
          onDeployPactoGov();
        }}
      >
        {hasPactoGov ? 'Open Governance tab' : 'Set up Pacto Gov'}
      </button>
    </li>

    <li class="launchpad-card" class:launchpad-card--locked={otherInfraLocked}>
      <h3 class="launchpad-card-title">Squad Admin</h3>
      <p class="launchpad-card-desc">
        {#if otherInfraLocked}
          Deploy squad sponsor first.
        {:else if hasSquadAdmin}
          Squad Admin is deployed. Open Settings → Manage squad roles to register roles and assign executors.
        {:else}
          Standalone executor roster (address-gated) without full Nave Pirata ceremony.
        {/if}
      </p>
      <button
        type="button"
        class="btn-primary launchpad-card-btn"
        disabled={otherInfraLocked || channelBlocked || hasSquadAdmin}
        on:click={() => {
          onClose();
          onDeploySquadAdmin();
        }}
      >
        {hasSquadAdmin ? 'Already deployed' : 'Deploy Squad Admin'}
      </button>
    </li>

    <li class="launchpad-card" class:launchpad-card--locked={otherInfraLocked}>
      <h3 class="launchpad-card-title">Gnosis Safe</h3>
      <p class="launchpad-card-desc">
        {#if otherInfraLocked}
          Deploy squad sponsor first.
        {:else if vaultSafeCount > 0}
          {vaultSafeCount} vault {vaultSafeCount === 1 ? 'Safe' : 'Safes'} linked on the squad network. Deploy a new Safe or import an existing address.
        {:else}
          Deploy a new multisig or import an existing Safe address.
        {/if}
      </p>
      <div class="launchpad-card-actions">
        <button
          type="button"
          class="btn-primary launchpad-card-btn"
          disabled={otherInfraLocked || channelBlocked}
          on:click={() => {
            onClose();
            onDeploySafe();
          }}
        >
          Deploy Safe
        </button>
        <button
          type="button"
          class="btn-secondary launchpad-card-btn"
          disabled={otherInfraLocked || channelBlocked}
          on:click={() => {
            onClose();
            onImportSafe();
          }}
        >
          Import Safe
        </button>
      </div>
    </li>

    <li class="launchpad-card launchpad-card--muted">
      <h3 class="launchpad-card-title">Bread Cooperative</h3>
      <p class="launchpad-card-desc muted">Reserved for cooperative governance. Not available in this release.</p>
      <button type="button" class="btn-secondary launchpad-card-btn" disabled>Coming later</button>
    </li>
  </ul>

  <div class="modal-actions">
    <button type="button" class="btn-secondary" on:click={onClose}>Close</button>
  </div>
</Modal>

<style>
  .launchpad-desc {
    margin: 0 0 16px;
    max-width: 52ch;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .launchpad-squad-network {
    margin: 0 0 16px;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .launchpad-squad-network-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .launchpad-squad-network-value {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .launchpad-squad-network-note {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .launchpad-channel-note {
    font-size: 0.875rem;
    margin: -8px 0 16px;
    max-width: 52ch;
  }

  .launchpad-grid {
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
  }

  .launchpad-card {
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 16px;
    background: var(--bg-elevated);
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
  }

  .launchpad-card--primary {
    border-color: var(--border-strong, var(--border-subtle));
  }

  .launchpad-card--locked {
    opacity: 0.88;
  }

  .launchpad-card--muted {
    opacity: 0.85;
  }

  .launchpad-card-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .launchpad-card-desc {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--text-secondary);
    flex: 1;
  }

  .launchpad-card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .launchpad-card-btn {
    align-self: flex-start;
  }

  .launchpad-deployed-status {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .launchpad-deployed-check {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--success) 18%, transparent);
    color: var(--success);
    font-size: 0.875rem;
    font-weight: 700;
    line-height: 22px;
    text-align: center;
  }

  .launchpad-deployed-body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .launchpad-deployed-label {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--success);
  }

  .launchpad-deployed-addr {
    display: block;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--text-secondary);
    word-break: break-all;
  }
</style>
