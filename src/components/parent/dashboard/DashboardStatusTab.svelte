<script lang="ts">
  import SmartContractSecuritySection from '../governance/SmartContractSecuritySection.svelte';
  import SquadBroadcastSettingsSection from './SquadBroadcastSettingsSection.svelte';
  import SquadBotHoldersSection from './SquadBotHoldersSection.svelte';
  import type { DashboardPermissionsContext } from '../../../lib/dashboard/permissions-panel';
  import type { ResolvedSquadAdminContext } from '../../../lib/governance/squad-admin-payload';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { listSquadDeployNetworkOptions } from '../../../lib/squad/squad-network';
  import type { Squad } from '../../../stores/squads';
  import { currentUser } from '../../../stores/auth';

  export let squad: Squad;
  export let permissionsCtx: DashboardPermissionsContext;
  export let squadAdminCtx: ResolvedSquadAdminContext | null = null;
  export let announcementsGroupId: string | null = null;
  export let parentId = '';
  export let channelMembers: string[] = [];
  export let squadMemberEvmByNpub: Record<string, string> = {};
  export let memberRolesByAddress: Record<string, string> = {};
  export let squadNetwork: SupportedChainId | null = null;
  export let squadNetworkFromInfra = false;
  export let onSetSquadNetwork: (chain: SupportedChainId) => void = () => {};
  export let onOpenSquadRolesModal: () => void = () => {};

  const squadNetworkOptions = listSquadDeployNetworkOptions();
  let squadNetworkChoice: SupportedChainId | '' = squadNetwork ?? '';
  $: squadNetworkChoice = squadNetwork ?? squadNetworkChoice;

  $: myNpub = $currentUser?.npub ?? '';
  $: myRosterEvm = myNpub ? squadMemberEvmByNpub[myNpub]?.trim() : '';

  function applySquadNetwork() {
    if (squadNetworkChoice && squadNetworkChoice !== squadNetwork) {
      onSetSquadNetwork(squadNetworkChoice);
    }
  }
</script>

<section class="dashboard-section checklist-stub" aria-labelledby="squad-status-checklist-heading">
  <h3 id="squad-status-checklist-heading" class="section-heading">Checklist</h3>
  <p class="muted dashboard-placeholder-text">Setup checklist coming soon.</p>
</section>

<SquadBroadcastSettingsSection {squad} />

<SquadBotHoldersSection
  {announcementsGroupId}
  {channelMembers}
  squadAdminActive={!!squadAdminCtx}
  executorRolesLabel={myRosterEvm
    ? memberRolesByAddress[myRosterEvm.trim().toLowerCase()] ?? ''
    : ''}
/>

<section
  id="squad-status-network"
  class="dashboard-section"
  aria-labelledby="squad-status-network-heading"
>
  <h3 id="squad-status-network-heading" class="section-heading">Squad network</h3>
  <p class="dashboard-placeholder-text muted">
    {#if squadNetwork}
      Squad infrastructure targets <strong>{getWalletNetworkDisplayName(squadNetwork)}</strong>.
      {#if squadNetworkFromInfra}
        Existing on-chain infrastructure is chain-bound; changing this only retargets future deployments.
      {/if}
    {:else}
      No network set yet. The first deployment picks and locks this squad's network.
    {/if}
  </p>
  <div class="squad-network-edit">
    <label class="squad-network-label" for="squad-status-network-select">Network for new deployments</label>
    <select id="squad-status-network-select" class="squad-network-select" bind:value={squadNetworkChoice}>
      <option value="" disabled>Select network…</option>
      {#each squadNetworkOptions as opt (opt.id)}
        <option value={opt.id}>{opt.label}</option>
      {/each}
    </select>
    <button
      type="button"
      class="btn-secondary squad-network-apply"
      disabled={!squadNetworkChoice || squadNetworkChoice === squadNetwork}
      on:click={applySquadNetwork}
    >
      Save
    </button>
  </div>
</section>

<section class="dashboard-section" aria-labelledby="squad-status-permissions-heading">
  <h3 id="squad-status-permissions-heading" class="section-heading">Permissions overview</h3>
  {#if permissionsCtx.phase === 'loading'}
    <p class="dashboard-placeholder-text muted">Loading permissions context…</p>
  {:else}
    <p class="dashboard-placeholder-text dashboard-placeholder-lead">{permissionsCtx.leadNote}</p>
    {#if permissionsCtx.pactoGovRevision}
      <p class="permissions-revision muted">
        pacto-gov revision <code class="permissions-revision-code">{permissionsCtx.pactoGovRevision}</code>
      </p>
    {/if}
    {#if permissionsCtx.catalogRows.length > 0}
      <div class="settings-actions-row">
        <p class="roles-table-caption">Privilege model</p>
        {#if squadAdminCtx}
          <button type="button" class="btn-secondary settings-roles-btn" on:click={onOpenSquadRolesModal}>
            Manage privileges
          </button>
        {/if}
      </div>
      <ul class="permissions-catalog-list" role="list">
        {#each permissionsCtx.catalogRows as row (row.id)}
          <li class="permissions-catalog-card">
            <h4 class="permissions-catalog-title">{row.title}</h4>
            <p class="permissions-catalog-summary">{row.summary}</p>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
  <SmartContractSecuritySection
    {parentId}
    announcementsGroupId={announcementsGroupId ?? ''}
    canManage={permissionsCtx.phase === 'pacto_gov'}
  />
</section>

<style>
  .dashboard-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .checklist-stub {
    margin-bottom: 16px;
  }
  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 12px 0;
  }
  .dashboard-placeholder-text {
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0 0 12px 0;
  }
  .dashboard-placeholder-lead {
    margin-bottom: 16px;
  }
  .muted {
    color: var(--text-muted);
  }
  .squad-network-edit {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px;
  }
  .squad-network-label {
    display: block;
    width: 100%;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    margin: 0 0 4px;
  }
  .squad-network-select {
    flex: 1;
    min-width: 160px;
    max-width: 240px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.9375rem;
  }
  .squad-network-apply {
    font-size: 0.875rem;
    padding: 8px 14px;
  }
  .permissions-revision {
    margin: 0 0 14px;
    font-size: 0.8125rem;
  }
  .permissions-revision-code {
    font-family: ui-monospace, monospace;
    color: var(--text-primary);
  }
  .permissions-catalog-list {
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .permissions-catalog-card {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 12px;
    background: var(--bg-elevated);
  }
  .permissions-catalog-title {
    margin: 0 0 6px;
    font-size: 0.9375rem;
    font-weight: 600;
  }
  .permissions-catalog-summary {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }
  .settings-actions-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .roles-table-caption {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    margin: 0;
  }
  .btn-secondary {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.875rem;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    cursor: pointer;
    font-family: inherit;
  }
  .btn-secondary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .settings-roles-btn {
    font-size: 0.8125rem;
    padding: 6px 12px;
  }
</style>
