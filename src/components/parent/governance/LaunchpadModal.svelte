<script lang="ts">
  import Modal from '../../ui/Modal.svelte';

  export let hasSponsor: boolean;
  export let hasPactoGov: boolean;
  export let hasSquadAdmin: boolean;
  export let hasAnnouncementsChannel: boolean;
  /** Sponsor clone address when already deployed. */
  export let sponsorAddress = '';
  /** Pacto Gov reference when deployed. */
  export let pactoGovAddress = '';
  /** Squad Admin proxy when deployed. */
  export let squadAdminAddress = '';
  export let onClose: () => void;
  export let onDeploySponsor: () => void;
  export let onDeploySquadAdmin: () => void;
  export let onDeployPactoGov: () => void;

  const titleId = 'deploy-governance-modal-title';
  const descId = 'deploy-governance-modal-desc';

  $: otherInfraLocked = !hasSponsor;
  $: channelBlocked = !hasAnnouncementsChannel;
</script>

<Modal {titleId} descriptionId={descId} {onClose} contentClass="launchpad-modal-panel">
  <h2 id={titleId}>Deploy Governance</h2>
  <p id={descId} class="launchpad-desc">
    Squad sponsor funds gas sponsorship and must be deployed first. Then set up Pacto Gov and Squad Admin.
  </p>

  {#if channelBlocked}
    <p class="launchpad-channel-note muted" role="status">
      Add an #announcements channel before deploying governance infra.
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
      {#if hasPactoGov}
        <div class="launchpad-deployed-status" role="status">
          <span class="launchpad-deployed-check" aria-hidden="true">✓</span>
          <div class="launchpad-deployed-body">
            <p class="launchpad-deployed-label">Deployed</p>
            {#if pactoGovAddress}
              <code class="launchpad-deployed-addr">{pactoGovAddress}</code>
            {/if}
          </div>
        </div>
      {:else}
        <p class="launchpad-card-desc">
          {#if otherInfraLocked}
            Deploy squad sponsor first.
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
          Set up Pacto Gov
        </button>
      {/if}
    </li>

    <li class="launchpad-card" class:launchpad-card--locked={otherInfraLocked}>
      <h3 class="launchpad-card-title">Squad Admin</h3>
      {#if hasSquadAdmin}
        <div class="launchpad-deployed-status" role="status">
          <span class="launchpad-deployed-check" aria-hidden="true">✓</span>
          <div class="launchpad-deployed-body">
            <p class="launchpad-deployed-label">Deployed</p>
            {#if squadAdminAddress}
              <code class="launchpad-deployed-addr">{squadAdminAddress}</code>
            {/if}
          </div>
        </div>
      {:else}
        <p class="launchpad-card-desc">
          {#if otherInfraLocked}
            Deploy squad sponsor first.
          {:else}
            Standalone executor roster (address-gated) without full Nave Pirata ceremony.
          {/if}
        </p>
        <button
          type="button"
          class="btn-primary launchpad-card-btn"
          disabled={otherInfraLocked || channelBlocked}
          on:click={() => {
            onClose();
            onDeploySquadAdmin();
          }}
        >
          Deploy Squad Admin
        </button>
      {/if}
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

  .muted {
    color: var(--text-muted);
  }
</style>
