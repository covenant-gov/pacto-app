<script lang="ts">
  import SmartContractSecuritySection from '../governance/SmartContractSecuritySection.svelte';
  import SquadRosterKeyInboxCard from '../../inbox/SquadRosterKeyInboxCard.svelte';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../../lib/utils/profile';
  import { profiles } from '../../../stores/profiles';
  import { currentUser } from '../../../stores/auth';
  import type { DashboardPermissionsContext } from '../../../lib/dashboard/permissions-panel';
  import type { ResolvedSquadAdminContext } from '../../../lib/governance/squad-admin-payload';

  export let squadInfraRows: unknown[] | undefined = undefined;
  export let hasSponsor = false;
  export let permissionsCtx: DashboardPermissionsContext;
  export let squadAdminCtx: ResolvedSquadAdminContext | null = null;
  export let settingsChainError = '';
  export let settingsChainLoading = false;
  export let settingsChainRefreshing = false;
  export let announcementsGroupId: string | null = null;
  export let parentId = '';
  export let channelMembers: string[] = [];
  export let loadingMembers = false;
  export let squadMemberEvmByNpub: Record<string, string> = {};
  export let memberHatByAddress: Record<string, string> = {};
  export let memberRolesByAddress: Record<string, string> = {};
  export let onOpenLaunchpad: () => void = () => {};
  export let onOpenSquadRolesModal: () => void = () => {};
  export let onRosterBindingChanged: () => void = () => {};

  function shortAddress(addr: string): string {
    if (!addr || addr.length < 12) return addr;
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  $: myNpub = $currentUser?.npub ?? '';
  $: myRosterEvm = myNpub ? squadMemberEvmByNpub[myNpub]?.trim() : '';
</script>

{#if squadInfraRows !== undefined && !hasSponsor}
  <div class="sponsor-empty-banner" role="status">
    <p class="sponsor-empty-banner-text">Deploy squad sponsor first using the Deploy button below.</p>
    <button type="button" class="btn-primary" on:click={onOpenLaunchpad}>Open Deploy</button>
  </div>
{/if}

<section
  id="settings-user-squad"
  class="dashboard-section dashboard-user-squad-section"
  aria-labelledby="settings-user-squad-heading"
>
  <h3 id="settings-user-squad-heading" class="section-heading">User-per-squad settings</h3>
  <p class="dashboard-placeholder-text dashboard-placeholder-lead">
    Roster address for this squad. Account-wide DM signer lives in Profile → Settings.
  </p>
  {#if announcementsGroupId && parentId}
    <p class="user-roster-current">
      Your roster EVM:
      <code class="user-roster-addr">{myRosterEvm ? shortAddress(myRosterEvm) : 'Not shared'}</code>
    </p>
    <div class="user-roster-actions">
      <SquadRosterKeyInboxCard
        {parentId}
        announcementsGroupId={announcementsGroupId}
        onComplete={onRosterBindingChanged}
      />
    </div>
  {:else}
    <p class="dashboard-placeholder-text muted">No announcements channel for this squad.</p>
  {/if}
</section>

<section
  id="settings-squad"
  class="dashboard-section dashboard-placeholder-section"
  aria-labelledby="settings-heading"
>
  <h3 id="settings-heading" class="section-heading">Squad settings</h3>
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
        <p class="roles-table-caption">Role model</p>
        {#if squadAdminCtx}
          <button type="button" class="btn-secondary settings-roles-btn" on:click={onOpenSquadRolesModal}>
            Manage squad roles
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
  {#if settingsChainRefreshing}
    <p class="dashboard-refresh-note muted" role="status">Refreshing on-chain member roles…</p>
  {/if}
  {#if settingsChainError && (Object.keys(memberHatByAddress).length > 0 || Object.keys(memberRolesByAddress).length > 0)}
    <p class="chain-read-error" role="alert">{settingsChainError}</p>
  {/if}
  {#if settingsChainError && Object.keys(memberHatByAddress).length === 0 && Object.keys(memberRolesByAddress).length === 0}
    <p class="chain-read-error" role="alert">{settingsChainError}</p>
  {/if}
  {#if announcementsGroupId}
    {#if loadingMembers && channelMembers.length === 0}
      <p class="roles-loading">Loading members…</p>
    {:else if channelMembers.length > 0}
      <p class="roles-table-caption">Members (#announcements)</p>
      <ul class="roles-member-list" role="list">
        {#each channelMembers as memberNpub (memberNpub)}
          {@const npub = memberNpub as string}
          {@const rosterEvm = squadMemberEvmByNpub[npub]}
          {@const avatarSrc = getProfileAvatarSrc($profiles[npub])}
          <li class="roles-member-row">
            {#if avatarSrc}
              <img src={avatarSrc} alt="" class="roles-member-avatar" />
            {:else}
              <div class="roles-member-avatar roles-member-avatar-ph" aria-hidden="true"></div>
            {/if}
            <div class="roles-member-meta">
              <span class="roles-member-name"
                >{getProfileDisplayName($profiles[npub]) ||
                  (npub.length > 20 ? npub.slice(0, 14) + '…' : npub)}</span
              >
              <code class="roles-member-npub">{npub.length > 28 ? npub.slice(0, 14) + '…' + npub.slice(-8) : npub}</code>
            </div>
            <div class="roles-member-cols">
              <span class="roles-col-label">EVM</span>
              <span class="roles-col-value" class:muted={!rosterEvm}
                >{rosterEvm ? shortAddress(rosterEvm) : 'Not shared'}</span
              >
              <span class="roles-col-label">Hats</span>
              <span class="roles-col-value" class:muted={!rosterEvm || !memberHatByAddress[rosterEvm.toLowerCase()]}
                >{settingsChainLoading && !memberHatByAddress[rosterEvm?.toLowerCase() ?? '']
                  ? 'Loading…'
                  : rosterEvm
                    ? memberHatByAddress[rosterEvm.toLowerCase()] || '—'
                    : 'Not shared'}</span
              >
              <span class="roles-col-label">Roles</span>
              <span
                class="roles-col-value"
                class:muted={!rosterEvm || !memberRolesByAddress[rosterEvm.toLowerCase()]}
                >{settingsChainLoading && !memberRolesByAddress[rosterEvm?.toLowerCase() ?? '']
                  ? 'Loading…'
                  : rosterEvm
                    ? memberRolesByAddress[rosterEvm.toLowerCase()] || '—'
                    : 'Not shared'}</span
              >
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="dashboard-placeholder-text muted">No members loaded yet. Open the members panel or switch to this tab again.</p>
    {/if}
  {:else}
    <p class="dashboard-placeholder-text muted">No announcements channel for this squad.</p>
  {/if}
  <SmartContractSecuritySection
    {parentId}
    announcementsGroupId={announcementsGroupId ?? ''}
    canManage={permissionsCtx.phase === 'pacto_gov'}
  />
</section>

<style>
  .sponsor-empty-banner {
    margin: 0 16px 16px;
    padding: 14px 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-elevated);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
  }

  .sponsor-empty-banner-text {
    margin: 0;
    flex: 1;
    min-width: 200px;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .dashboard-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
  }

  .dashboard-user-squad-section {
    margin-bottom: 16px;
  }

  .user-roster-current {
    margin: 0 0 12px;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .user-roster-addr {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    color: var(--text-primary);
  }

  .user-roster-actions :global(.roster-key-card) {
    margin: 0;
    max-width: none;
  }

  .dashboard-placeholder-section .section-heading {
    margin-bottom: 8px;
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

  .dashboard-placeholder-text.muted,
  .muted {
    color: var(--text-muted);
  }

  .permissions-revision {
    margin: 0 0 14px;
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  .permissions-revision-code {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
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
    color: var(--text-primary);
  }

  .permissions-catalog-summary {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
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

  .settings-roles-btn {
    font-size: 0.8125rem;
    padding: 6px 12px;
  }

  .roles-loading {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0;
  }

  .roles-table-caption {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    margin: 0 0 8px 0;
  }

  .roles-member-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    overflow: hidden;
  }

  .roles-member-row {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) minmax(0, 1.2fr);
    gap: 12px;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 0.8125rem;
  }

  .roles-member-row:last-child {
    border-bottom: none;
  }

  .roles-member-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
  }

  .roles-member-avatar-ph {
    background: var(--border);
  }

  .roles-member-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .roles-member-name {
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .roles-member-npub {
    font-size: 0.7rem;
    color: var(--text-muted);
    word-break: break-all;
  }

  .roles-member-cols {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    align-items: baseline;
  }

  .roles-col-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .roles-col-value {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .btn-primary,
  .btn-secondary {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    border: none;
  }

  .btn-secondary {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
</style>
