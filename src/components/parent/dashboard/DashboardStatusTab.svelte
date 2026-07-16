<script lang="ts">
  import SmartContractSecuritySection from '../governance/SmartContractSecuritySection.svelte';
  import SquadBroadcastSettingsSection from './SquadBroadcastSettingsSection.svelte';
  import SquadBotHoldersSection from './SquadBotHoldersSection.svelte';
  import EditIconButton from '../../ui/EditIconButton.svelte';
  import type { DashboardPermissionsContext } from '../../../lib/dashboard/permissions-panel';
  import type { ResolvedSquadAdminContext } from '../../../lib/governance/squad-admin-payload';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { listSquadDeployNetworkOptions } from '../../../lib/squad/squad-network';
  import type { Squad } from '../../../stores/squads';
  import { currentUser } from '../../../stores/auth';
  import {
    allMembersShareEvmState,
    binaryInfraState,
    checklistGlyph,
    mintCrewHatsState,
    type ChecklistItemState,
  } from '../../../lib/governance/squad-sponsor-crew';

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
  export let hasGovernance = false;
  export let hasSquadAdmin = false;
  export let captainWearers: string[] = [];
  export let crewWearers: string[] = [];
  export let onOpenDeploy: () => void = () => {};
  export let onOpenCrewBootstrap: () => void = () => {};

  const squadNetworkOptions = listSquadDeployNetworkOptions();
  let editingNetwork = false;
  let squadNetworkChoice: SupportedChainId | '' = squadNetwork ?? '';
  $: if (!editingNetwork) squadNetworkChoice = squadNetwork ?? '';

  $: myNpub = $currentUser?.npub ?? '';
  $: myRosterEvm = myNpub ? squadMemberEvmByNpub[myNpub]?.trim() : '';
  $: networkLabel = squadNetwork ? getWalletNetworkDisplayName(squadNetwork) : 'Not set';
  $: networkHint = squadNetworkFromInfra ? 'Locked to deployed infra' : '';
  $: shareEvmState = allMembersShareEvmState(channelMembers, squadMemberEvmByNpub);
  $: govState = binaryInfraState(hasGovernance);
  $: adminState = binaryInfraState(hasSquadAdmin);
  $: crewMintState = mintCrewHatsState({
    hasGovernance,
    channelMembers,
    squadMemberEvmByNpub,
    captainWearers,
    crewWearers,
  });

  function glyphClass(state: ChecklistItemState): string {
    if (state === 'done') return 'check-mark';
    if (state === 'pending') return 'check-pending';
    return 'check-todo';
  }

  function applySquadNetwork() {
    if (squadNetworkChoice && squadNetworkChoice !== squadNetwork) {
      onSetSquadNetwork(squadNetworkChoice);
    }
    editingNetwork = false;
  }

  function cancelNetworkEdit() {
    squadNetworkChoice = squadNetwork ?? '';
    editingNetwork = false;
  }
</script>

<section class="status-checklist" aria-label="Setup checklist">
  <span class="meta-label">Checklist</span>
  <ul class="checklist" role="list">
    <li class="checklist-item" class:done={!!squadNetwork}>
      <span class={glyphClass(squadNetwork ? 'done' : 'not_started')} aria-hidden="true"
        >{checklistGlyph(squadNetwork ? 'done' : 'not_started')}</span
      >
      {#if squadNetwork}
        <span>{getWalletNetworkDisplayName(squadNetwork)} selected</span>
      {:else}
        <button
          type="button"
          class="checklist-action"
          on:click={() => {
            editingNetwork = true;
            document.getElementById('squad-status-network')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }}
        >
          Select network
        </button>
      {/if}
    </li>
    <li class="checklist-item" class:done={shareEvmState === 'done'}>
      <span class={glyphClass(shareEvmState)} aria-hidden="true">{checklistGlyph(shareEvmState)}</span>
      <span>All members share EVM address</span>
    </li>
    <li class="checklist-item" class:done={govState === 'done'}>
      <span class={glyphClass(govState)} aria-hidden="true">{checklistGlyph(govState)}</span>
      {#if hasGovernance}
        <span>Squad governance</span>
      {:else}
        <button type="button" class="checklist-action" on:click={onOpenDeploy}>Deploy Squad governance</button>
      {/if}
    </li>
    <li class="checklist-item" class:done={adminState === 'done'}>
      <span class={glyphClass(adminState)} aria-hidden="true">{checklistGlyph(adminState)}</span>
      {#if hasSquadAdmin}
        <span>Squad admin</span>
      {:else}
        <button type="button" class="checklist-action" on:click={onOpenDeploy}>Deploy Squad admin</button>
      {/if}
    </li>
    <li class="checklist-item" class:done={crewMintState === 'done'}>
      <span class={glyphClass(crewMintState)} aria-hidden="true">{checklistGlyph(crewMintState)}</span>
      {#if crewMintState === 'done'}
        <span>Mint all members a Crew hat</span>
      {:else if hasGovernance}
        <button type="button" class="checklist-action" on:click={onOpenCrewBootstrap}
          >Mint all members a Crew hat</button
        >
      {:else}
        <span>Mint all members a Crew hat</span>
      {/if}
    </li>
  </ul>
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

<div class="status-fact-row" id="squad-status-network">
  <span class="meta-label">Network</span>
  {#if editingNetwork}
    <select class="network-select" bind:value={squadNetworkChoice} aria-label="Squad network">
      <option value="" disabled>Select…</option>
      {#each squadNetworkOptions as opt (opt.id)}
        <option value={opt.id}>{opt.label}</option>
      {/each}
    </select>
    <button
      type="button"
      class="btn-text"
      disabled={!squadNetworkChoice || squadNetworkChoice === squadNetwork}
      on:click={applySquadNetwork}
    >
      Save
    </button>
    <button type="button" class="btn-text muted" on:click={cancelNetworkEdit}>Cancel</button>
  {:else}
    <span class="network-value">{networkLabel}</span>
    {#if networkHint}
      <span class="muted network-hint">{networkHint}</span>
    {/if}
    <EditIconButton
      ariaLabel="Edit squad network"
      title="Edit network"
      on:click={() => (editingNetwork = true)}
    />
  {/if}
</div>

{#if parentId}
  <SmartContractSecuritySection
    {parentId}
    announcementsGroupId={announcementsGroupId ?? ''}
    canManage={permissionsCtx.phase === 'pacto_gov'}
    compact
  />
{/if}

<style>
  .status-checklist {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 0 12px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 0.875rem;
  }

  .status-fact-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 8px 0;
    margin-bottom: 0;
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

  .checklist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .checklist-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .check-mark {
    color: #1a7f4b;
    font-weight: 700;
    width: 1.1rem;
    text-align: center;
  }

  .check-todo {
    color: var(--text-muted);
    width: 1.1rem;
    text-align: center;
  }

  .check-pending {
    width: 1.1rem;
    text-align: center;
    font-size: 0.75rem;
    line-height: 1.1rem;
  }

  .checklist-item.done span:last-child {
    color: var(--text-primary);
  }

  .checklist-action {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .network-value {
    font-weight: 500;
    color: var(--text-primary);
  }

  .network-hint {
    font-size: 0.75rem;
  }

  .muted {
    color: var(--text-muted);
  }

  .network-select {
    min-width: 140px;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.875rem;
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

  .btn-text:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    text-decoration: none;
  }
</style>
