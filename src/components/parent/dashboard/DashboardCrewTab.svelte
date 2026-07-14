<script lang="ts">
  import SquadJoinRequestsPanel from '../../squad/SquadJoinRequestsPanel.svelte';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../../lib/utils/profile';
  import { profiles } from '../../../stores/profiles';
  import type { Squad } from '../../../stores/squads';

  export let squad: Squad;
  export let announcementsGroupId: string | null = null;
  export let channelMembers: string[] = [];
  export let loadingMembers = false;
  export let settingsChainError = '';
  export let settingsChainLoading = false;
  export let settingsChainRefreshing = false;
  export let squadMemberEvmByNpub: Record<string, string> = {};
  export let memberHatByAddress: Record<string, string> = {};
  export let memberRolesByAddress: Record<string, string> = {};
  export let onOpenSquadRolesModal: () => void = () => {};
  export let showManagePrivileges = false;
  export let pactoGovRevision = '';

  function shortAddress(addr: string): string {
    if (!addr || addr.length < 12) return addr;
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }
</script>

<section class="dashboard-section" aria-labelledby="crew-roster-heading">
  <h3 id="crew-roster-heading" class="section-heading">Crew</h3>
  <p class="caption muted">Membership from #announcements (MLS). Hats and privileges may be empty.</p>

  {#if settingsChainRefreshing}
    <p class="muted" role="status">Refreshing on-chain member data…</p>
  {/if}
  {#if settingsChainError}
    <p class="chain-read-error" role="alert">{settingsChainError}</p>
  {/if}

  {#if announcementsGroupId}
    {#if loadingMembers && channelMembers.length === 0}
      <p class="muted">Loading members…</p>
    {:else if channelMembers.length > 0}
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
              <code class="roles-member-npub"
                >{npub.length > 28 ? npub.slice(0, 14) + '…' + npub.slice(-8) : npub}</code
              >
            </div>
            <div class="roles-member-cols">
              <span class="roles-col-label">EVM</span>
              <span class="roles-col-value" class:muted={!rosterEvm}
                >{rosterEvm ? shortAddress(rosterEvm) : 'Not shared'}</span
              >
              <span class="roles-col-label">Hats</span>
              <span
                class="roles-col-value"
                class:muted={!rosterEvm || !memberHatByAddress[rosterEvm.toLowerCase()]}
                >{settingsChainLoading && !memberHatByAddress[rosterEvm?.toLowerCase() ?? '']
                  ? 'Loading…'
                  : rosterEvm
                    ? memberHatByAddress[rosterEvm.toLowerCase()] || '—'
                    : 'Not shared'}</span
              >
              <span class="roles-col-label">Privileges</span>
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
      <p class="muted">No members loaded yet.</p>
    {/if}
  {:else}
    <p class="muted">No announcements channel for this squad.</p>
  {/if}
</section>

{#if showManagePrivileges || pactoGovRevision}
  <div class="privileges-row">
    <span class="meta-label">Privileges</span>
    {#if pactoGovRevision}
      <code class="rev">{pactoGovRevision}</code>
    {/if}
    {#if showManagePrivileges}
      <button type="button" class="btn-text" on:click={onOpenSquadRolesModal}>Manage</button>
    {/if}
  </div>
{/if}

{#if squad}
  <section class="join-requests-wrap" aria-label="Join requests">
    <SquadJoinRequestsPanel {squad} />
  </section>
{/if}

<style>
  .dashboard-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 8px;
  }
  .caption {
    font-size: 0.8125rem;
    margin: 0 0 12px;
  }
  .muted {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  .chain-read-error {
    color: var(--danger, #c44);
    font-size: 0.875rem;
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
  .privileges-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 8px 0 12px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 0.875rem;
  }
  .meta-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    min-width: 5.5rem;
  }
  .rev {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .btn-text {
    padding: 4px 8px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .join-requests-wrap {
    margin-top: 8px;
  }
</style>
