<script lang="ts">
  import JoinInboxHoldersSection from './JoinInboxHoldersSection.svelte';
  import SquadBroadcastSettingsSection from './SquadBroadcastSettingsSection.svelte';
  import SquadIdentitySection from './SquadIdentitySection.svelte';
  import SquadJoinRequestsPanel from '../../squad/SquadJoinRequestsPanel.svelte';
  import type { ResolvedSquadAdminContext } from '../../../lib/governance/squad-admin-payload';
  import type { Squad } from '../../../stores/squads';
  import { currentUser } from '../../../stores/auth-session';
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
    onInvite = () => {},
  }: {
    squad: Squad;
    squadAdminCtx?: ResolvedSquadAdminContext | null;
    announcementsGroupId?: string | null;
    parentId?: string;
    channelMembers?: string[];
    squadMemberEvmByNpub?: Record<string, string>;
    memberRolesByAddress?: Record<string, string>;
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
  <SquadIdentitySection {squad} />
  <SquadBroadcastSettingsSection {squad} />
  <SquadJoinRequestsPanel {squad} {onInvite} />
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
