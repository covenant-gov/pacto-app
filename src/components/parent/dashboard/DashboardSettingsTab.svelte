<script lang="ts">
  import SquadBotHoldersSection from './SquadBotHoldersSection.svelte';
  import SquadBroadcastSettingsSection from './SquadBroadcastSettingsSection.svelte';
  import SquadEndpointsPanel from './SquadEndpointsPanel.svelte';
  import SquadIdentitySection from './SquadIdentitySection.svelte';
  import SquadNetworkSection from './SquadNetworkSection.svelte';
  import SquadStickersSection from './SquadStickersSection.svelte';
  import type { ResolvedSquadAdminContext } from '../../../lib/governance/squad-admin-payload';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import type { SquadRpcConfig } from '../../../lib/squad/squad-rpc';
  import type { Squad } from '../../../stores/squads';
  import { currentUser } from '../../../stores/auth';
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
    squadNetwork = null,
    squadNetworkFromInfra = false,
    onSetSquadNetwork = () => {},
    squadRpcConfig = null,
    onSetSquadRpcPrimary = () => {},
    onSetSquadRpcBackup = () => {},
    onClearSquadRpcPrimary = () => {},
  }: {
    squad: Squad;
    squadAdminCtx?: ResolvedSquadAdminContext | null;
    announcementsGroupId?: string | null;
    parentId?: string;
    channelMembers?: string[];
    squadMemberEvmByNpub?: Record<string, string>;
    memberRolesByAddress?: Record<string, string>;
    squadNetwork?: SupportedChainId | null;
    squadNetworkFromInfra?: boolean;
    onSetSquadNetwork?: (chain: SupportedChainId) => void;
    squadRpcConfig?: SquadRpcConfig | null;
    onSetSquadRpcPrimary?: (url: string) => string | void | Promise<string | void>;
    onSetSquadRpcBackup?: (url: string) => string | void | Promise<string | void>;
    onClearSquadRpcPrimary?: () => void | Promise<void>;
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

  <SquadStickersSection {squad} {announcementsGroupId} />

  <SquadNetworkSection {squadNetwork} {squadNetworkFromInfra} {onSetSquadNetwork} />

  <SquadEndpointsPanel
    {squadNetwork}
    {squadRpcConfig}
    {onSetSquadRpcPrimary}
    {onSetSquadRpcBackup}
    {onClearSquadRpcPrimary}
  />

  <SquadBotHoldersSection
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
