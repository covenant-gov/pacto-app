<script lang="ts">
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
  <SquadJoinRequestsPanel {squad} {onInvite} />

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
</style>
