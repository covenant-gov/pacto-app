<script lang="ts">
  import { t } from 'svelte-i18n';
  import JoinInboxHoldersSection from './JoinInboxHoldersSection.svelte';
  import SquadContentPolicySection from './SquadContentPolicySection.svelte';
  import SquadPrivilegesSection from './SquadPrivilegesSection.svelte';
  import SquadJoinRequestsPanel from '../../squad/SquadJoinRequestsPanel.svelte';
  import type { ResolvedSquadAdminContext } from '../../../lib/governance/squad-admin-payload';
  import type { Squad } from '../../../stores/squads';
  import { currentUser } from '../../../stores/auth-session';
  import { resolvePollsMlsGroupId } from '../../../lib/parent-navbar';
  import {
    needsSquadRosterKeyChoice,
    squadMemberEvmForDisplay,
  } from '../../../lib/squad/squad-roster-key-choice';

  let {
    squad,
    squadAdminCtx = null,
    announcementsGroupId = null,
    parentId = '',
    channelMembers = [],
    squadMemberEvmByNpub = {},
    memberRolesByAddress = {},
    privilegesAdmin = null,
    pactoGovRevision = '',
    memberEvmOptions = [],
    onInvite = () => {},
  }: {
    squad: Squad;
    squadAdminCtx?: ResolvedSquadAdminContext | null;
    announcementsGroupId?: string | null;
    parentId?: string;
    channelMembers?: string[];
    squadMemberEvmByNpub?: Record<string, string>;
    memberRolesByAddress?: Record<string, string>;
    privilegesAdmin?: ResolvedSquadAdminContext | null;
    pactoGovRevision?: string;
    memberEvmOptions?: { address: string; label: string }[];
    onInvite?: () => void;
  } = $props();

  let rosterKeyNeeded = $state(false);

  const myNpub = $derived($currentUser?.npub ?? '');
  const displayEvmByNpub = $derived(squadMemberEvmForDisplay(squadMemberEvmByNpub, myNpub, rosterKeyNeeded));
  const myRosterEvm = $derived(myNpub ? displayEvmByNpub[myNpub]?.trim() : '');

  $effect(() => {
    const pid = parentId;
    const gid = announcementsGroupId;
    if (!pid) return;
    void needsSquadRosterKeyChoice(pid, gid).then((needed) => {
      if (parentId !== pid) return;
      rosterKeyNeeded = needed;
    });
  });
</script>

<div class="settings-stack">
  <section class="invite-section" aria-labelledby="settings-access-invite-heading">
    <h3 id="settings-access-invite-heading" class="section-heading">{$t('nav.parentSidebar.invite')}</h3>
    <button type="button" class="btn-primary" onclick={onInvite}>
      {$t('nav.parentSidebar.invite')}
    </button>
  </section>

  <SquadJoinRequestsPanel {squad} />

  <SquadPrivilegesSection
    {parentId}
    {privilegesAdmin}
    {pactoGovRevision}
    {memberEvmOptions}
  />

  <SquadContentPolicySection parentId={squad.id} mlsGroupId={resolvePollsMlsGroupId(squad)} />

  <JoinInboxHoldersSection
    {announcementsGroupId}
    {channelMembers}
    squadAdminActive={!!squadAdminCtx}
    executorRolesLabel={myRosterEvm
      ? memberRolesByAddress[myRosterEvm.trim().toLowerCase()] ?? ''
      : ''}
  />
</div>

<style>
  .settings-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .invite-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
  }
  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 12px;
  }
  .btn-primary {
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 0.875rem;
    font-family: inherit;
    background: var(--brand);
    color: var(--on-brand);
    border: none;
    cursor: pointer;
  }
  .btn-primary:hover {
    filter: brightness(1.05);
  }
</style>
