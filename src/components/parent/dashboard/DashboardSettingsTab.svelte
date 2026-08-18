<script lang="ts">
  import SmartContractSecuritySection from '../governance/SmartContractSecuritySection.svelte';
  import SquadBotHoldersSection from './SquadBotHoldersSection.svelte';
  import SquadEndpointsPanel from './SquadEndpointsPanel.svelte';
  import SquadNetworkSection from './SquadNetworkSection.svelte';
  import SquadStickersSection from './SquadStickersSection.svelte';
  import type { DashboardPermissionsContext } from '../../../lib/dashboard/permissions-panel';
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
    permissionsCtx,
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
    permissionsCtx: DashboardPermissionsContext;
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
      rosterKeyNeeded = needed;
    });
  });
</script>

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

{#if parentId}
  <SmartContractSecuritySection
    {parentId}
    announcementsGroupId={announcementsGroupId ?? ''}
    canManage={permissionsCtx.phase === 'pacto_gov'}
    compact
  />
{/if}

<SquadStickersSection {squad} {announcementsGroupId} />
