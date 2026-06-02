<script lang="ts">
  import Modal from '../../ui/Modal.svelte';

  export let hasSponsor: boolean;
  export let hasPactoGov: boolean;
  export let hasSquadAdmin: boolean;
  export let vaultSafeCount = 0;
  export let hasAnnouncementsChannel: boolean;
  export let onClose: () => void;
  export let onDeploySponsor: () => void;
  export let onDeploySquadAdmin: () => void;
  export let onDeployPactoGov: () => void;
  export let onDeploySafe: () => void;
  export let onImportSafe: () => void;

  const titleId = 'launchpad-modal-title';
  const descId = 'launchpad-modal-desc';

  $: otherInfraLocked = !hasSponsor;
  $: channelBlocked = !hasAnnouncementsChannel;
</script>

<Modal {titleId} descriptionId={descId} {onClose} contentClass="launchpad-modal-panel">
  <h2 id={titleId}>Deploy infra</h2>
  <p id={descId} class="launchpad-desc">
    Choose on-chain infrastructure for this squad. Squad sponsor funds gas sponsorship and must be deployed first.
  </p>
  {#if channelBlocked}
    <p class="launchpad-channel-note muted" role="status">
      Add an #announcements channel before deploying or linking treasury infra.
    </p>
  {/if}

  <ul class="launchpad-grid" role="list">
    <li class="launchpad-card" class:launchpad-card--primary={!hasSponsor}>
      <h3 class="launchpad-card-title">Squad sponsor</h3>
      <p class="launchpad-card-desc">
        {#if hasSponsor}
          Sponsor clone is deployed. Top up balance from the Treasury tab or deposit again after deploy.
        {:else}
          Required first deploy — ERC-4337 gas pool for this squad.
        {/if}
      </p>
      <button
        type="button"
        class="btn-primary launchpad-card-btn"
        disabled={channelBlocked}
        on:click={() => {
          onClose();
          onDeploySponsor();
        }}
      >
        {hasSponsor ? 'Deploy another network…' : 'Deploy squad sponsor'}
      </button>
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
          {vaultSafeCount} vault {vaultSafeCount === 1 ? 'Safe' : 'Safes'} linked. Deploy another or import an existing address.
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
</style>
