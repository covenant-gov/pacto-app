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
  export let onDeployGovAndSponsor: () => void;
  export let onDeployPactoGov: () => void = () => {};
  export let onDeployExtSponsor: () => void;
  export let onDeploySquadAdmin: () => void;

  const titleId = 'deploy-governance-modal-title';
  const descId = 'deploy-governance-modal-desc';

  $: channelBlocked = !hasAnnouncementsChannel;
  $: combinedDone = hasPactoGov && hasSponsor;
  $: combinedAvailable = !hasPactoGov && !hasSponsor;
  $: finishSponsor = hasPactoGov && !hasSponsor;
</script>

<Modal {titleId} descriptionId={descId} {onClose} contentClass="launchpad-modal-panel">
  <h2 id={titleId}>Deploy Governance</h2>
  <p id={descId} class="launchpad-desc">
    Recommended: deploy Pacto Gov and a hats-linked squad sponsor together so gas sponsorship follows
    captain and crew hats.
  </p>

  {#if channelBlocked}
    <p class="launchpad-channel-note muted" role="status">
      Add an #announcements channel before deploying governance infra.
    </p>
  {/if}

  <ul class="launchpad-primary" role="list">
    <li class="launchpad-card" class:launchpad-card--primary={combinedAvailable || finishSponsor}>
      <h3 class="launchpad-card-title">Pacto Gov + squad sponsor</h3>
      {#if combinedDone}
        <div class="launchpad-deployed-status" role="status">
          <span class="launchpad-deployed-check" aria-hidden="true">✓</span>
          <div class="launchpad-deployed-body">
            <p class="launchpad-deployed-label">Deployed</p>
            {#if pactoGovAddress}
              <code class="launchpad-deployed-addr">Gov {pactoGovAddress}</code>
            {/if}
            {#if sponsorAddress}
              <code class="launchpad-deployed-addr">Sponsor {sponsorAddress}</code>
            {/if}
          </div>
        </div>
      {:else if finishSponsor}
        <p class="launchpad-card-desc">
          Governance is live. Finish with a hats-linked sponsor (same wizard as combined deploy).
        </p>
        <button
          type="button"
          class="btn-primary launchpad-card-btn"
          disabled={channelBlocked}
          on:click={() => {
            onClose();
            onDeployGovAndSponsor();
          }}
        >
          Deploy squad sponsor
        </button>
      {:else if hasSponsor && !hasPactoGov}
        <p class="launchpad-card-desc">
          Sponsor is live without Pacto Gov. Deploy governance alone to finish setup.
        </p>
        <button
          type="button"
          class="btn-primary launchpad-card-btn"
          disabled={channelBlocked}
          on:click={() => {
            onClose();
            onDeployPactoGov();
          }}
        >
          Deploy Pacto Gov
        </button>
      {:else}
        <p class="launchpad-card-desc">
          One flow: Nave Pirata (Hats tree + Safe) then hats-based gas sponsorship. Optional crew
          bootstrap.
        </p>
        <button
          type="button"
          class="btn-primary launchpad-card-btn"
          disabled={channelBlocked}
          on:click={() => {
            onClose();
            onDeployGovAndSponsor();
          }}
        >
          Deploy Pacto Gov + squad sponsor
        </button>
      {/if}
    </li>
  </ul>

  <div class="launchpad-divider" role="separator">
    <span class="launchpad-divider-line" aria-hidden="true"></span>
    <p class="launchpad-advanced-blurb muted">
      Advanced: deploy a standalone Ext sponsor or Squad Admin without full Nave Pirata.
    </p>
  </div>

  <ul class="launchpad-grid" role="list">
    <li class="launchpad-card">
      <h3 class="launchpad-card-title">Squad sponsor (Ext)</h3>
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
        <p class="launchpad-card-desc">
          Address-list sponsor: roster EVM owns the allowlist; Default may pay gas and the initial deposit.
        </p>
        <button
          type="button"
          class="btn-primary launchpad-card-btn"
          disabled={channelBlocked}
          on:click={() => {
            onClose();
            onDeployExtSponsor();
          }}
        >
          Deploy squad sponsor (Ext)
        </button>
      {/if}
    </li>
    <li class="launchpad-card">
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
          Standalone executor roster without full Nave Pirata ceremony.
        </p>
        <button
          type="button"
          class="btn-primary launchpad-card-btn"
          disabled={channelBlocked}
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

  .launchpad-primary {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
  }

  .launchpad-divider {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 4px 0 16px;
  }

  .launchpad-divider-line {
    display: block;
    height: 1px;
    background: var(--border-subtle);
  }

  .launchpad-advanced-blurb {
    margin: 0;
    max-width: 52ch;
    font-size: 0.8125rem;
    line-height: 1.45;
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
