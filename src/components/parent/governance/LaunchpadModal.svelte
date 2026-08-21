<script lang="ts">
  import { t } from 'svelte-i18n';
  import Modal from '../../ui/Modal.svelte';
  import {
    launchpadCtaDisabled,
    launchpadPrimaryCardState,
  } from '../../../lib/governance/launchpad-cta';

  let {
    hasSponsor,
    hasPactoGov,
    hasSquadAdmin,
    hasAnnouncementsChannel,
    sponsorAddress = '',
    pactoGovAddress = '',
    squadAdminAddress = '',
    onClose,
    onDeployGovAndSponsor,
    onDeployPactoGov = () => {},
    onDeployExtSponsor,
    onDeploySquadAdmin,
  }: {
    hasSponsor: boolean;
    hasPactoGov: boolean;
    hasSquadAdmin: boolean;
    hasAnnouncementsChannel: boolean;
    /** Sponsor clone address when already deployed. */
    sponsorAddress?: string;
    /** Pacto Gov reference when deployed. */
    pactoGovAddress?: string;
    /** Squad Admin proxy when deployed. */
    squadAdminAddress?: string;
    onClose: () => void;
    onDeployGovAndSponsor: () => void;
    onDeployPactoGov?: () => void;
    onDeployExtSponsor: () => void;
    onDeploySquadAdmin: () => void;
  } = $props();

  const titleId = 'deploy-governance-modal-title';
  const descId = 'deploy-governance-modal-desc';

  const channelBlocked = $derived(launchpadCtaDisabled({ hasAnnouncementsChannel }));
  const primaryCard = $derived(launchpadPrimaryCardState({ hasSponsor, hasPactoGov }));
</script>

<Modal {titleId} descriptionId={descId} {onClose} contentClass="launchpad-modal-panel">
  <h2 id={titleId}>{$t('governance.launchpad.title')}</h2>
  <p id={descId} class="launchpad-desc">
    {$t('governance.launchpad.description')}
  </p>

  {#if channelBlocked}
    <p class="launchpad-channel-note muted" role="status">
      {$t('governance.launchpad.channelNote')}
    </p>
  {/if}

  <ul class="launchpad-primary" role="list">
    <li class="launchpad-card" class:launchpad-card--primary={primaryCard !== 'deployed'}>
      <h3 class="launchpad-card-title">{$t('governance.launchpad.primaryCard.title')}</h3>
      {#if primaryCard === 'deployed'}
        <div class="launchpad-deployed-status" role="status">
          <span class="launchpad-deployed-check" aria-hidden="true">✓</span>
          <div class="launchpad-deployed-body">
            <p class="launchpad-deployed-label">{$t('governance.launchpad.status.deployed')}</p>
            {#if pactoGovAddress}
              <code class="launchpad-deployed-addr">{$t('governance.launchpad.govLabel', { values: { address: pactoGovAddress } })}</code>
            {/if}
            {#if sponsorAddress}
              <code class="launchpad-deployed-addr">{$t('governance.launchpad.sponsorLabel', { values: { address: sponsorAddress } })}</code>
            {/if}
          </div>
        </div>
      {:else if primaryCard === 'finish-sponsor'}
        <p class="launchpad-card-desc">
          {$t('governance.launchpad.primaryCard.finishSponsor.description')}
        </p>
        <button
          type="button"
          class="btn-primary launchpad-card-btn"
          disabled={channelBlocked}
          onclick={() => {
            onClose();
            onDeployGovAndSponsor();
          }}
        >
          {$t('governance.launchpad.primaryCard.finishSponsor.action')}
        </button>
      {:else if primaryCard === 'deploy-gov'}
        <p class="launchpad-card-desc">
          {$t('governance.launchpad.primaryCard.deployGov.description')}
        </p>
        <button
          type="button"
          class="btn-primary launchpad-card-btn"
          disabled={channelBlocked}
          onclick={() => {
            onClose();
            onDeployPactoGov();
          }}
        >
          {$t('governance.launchpad.primaryCard.deployGov.action')}
        </button>
      {:else}
        <p class="launchpad-card-desc">
          {$t('governance.launchpad.primaryCard.combined.description')}
        </p>
        <button
          type="button"
          class="btn-primary launchpad-card-btn"
          disabled={channelBlocked}
          onclick={() => {
            onClose();
            onDeployGovAndSponsor();
          }}
        >
          {$t('governance.launchpad.primaryCard.combined.action')}
        </button>
      {/if}
    </li>
  </ul>

  <div class="launchpad-divider" role="separator">
    <span class="launchpad-divider-line" aria-hidden="true"></span>
    <p class="launchpad-advanced-blurb muted">
      {$t('governance.launchpad.advancedBlurb')}
    </p>
  </div>

  <ul class="launchpad-grid" role="list">
    <li class="launchpad-card">
      <h3 class="launchpad-card-title">{$t('governance.launchpad.extSponsor.title')}</h3>
      {#if hasSponsor}
        <div class="launchpad-deployed-status" role="status">
          <span class="launchpad-deployed-check" aria-hidden="true">✓</span>
          <div class="launchpad-deployed-body">
            <p class="launchpad-deployed-label">{$t('governance.launchpad.status.deployed')}</p>
            {#if pactoGovAddress}
              <code class="launchpad-deployed-addr">{$t('governance.launchpad.govLabel', { values: { address: pactoGovAddress } })}</code>
            {/if}
            {#if sponsorAddress}
              <code class="launchpad-deployed-addr">{$t('governance.launchpad.sponsorLabel', { values: { address: sponsorAddress } })}</code>
            {/if}
          </div>
        </div>
      {:else}
        <p class="launchpad-card-desc">
          {$t('governance.launchpad.extSponsor.description')}
        </p>
        <button
          type="button"
          class="btn-primary launchpad-card-btn"
          disabled={channelBlocked}
          onclick={() => {
            onClose();
            onDeployExtSponsor();
          }}
        >
          {$t('governance.launchpad.extSponsor.action')}
        </button>
      {/if}
    </li>
    <li class="launchpad-card">
      <h3 class="launchpad-card-title">{$t('governance.launchpad.squadAdmin.title')}</h3>
      {#if hasSquadAdmin}
        <div class="launchpad-deployed-status" role="status">
          <span class="launchpad-deployed-check" aria-hidden="true">✓</span>
          <div class="launchpad-deployed-body">
            <p class="launchpad-deployed-label">{$t('governance.launchpad.status.deployed')}</p>
            {#if squadAdminAddress}
              <code class="launchpad-deployed-addr">{squadAdminAddress}</code>
            {/if}
          </div>
        </div>
      {:else}
        <p class="launchpad-card-desc">
          {$t('governance.launchpad.squadAdmin.description')}
        </p>
        <button
          type="button"
          class="btn-primary launchpad-card-btn"
          disabled={channelBlocked}
          onclick={() => {
            onClose();
            onDeploySquadAdmin();
          }}
        >
          {$t('governance.launchpad.squadAdmin.action')}
        </button>
      {/if}
    </li>
  </ul>

  <div class="modal-actions">
    <button type="button" class="btn-secondary" onclick={onClose}>{$t('governance.common.close')}</button>
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
