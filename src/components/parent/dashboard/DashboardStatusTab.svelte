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
  export let hasSponsor = false;
  export let hasGovernance = false;
  export let hasSquadAdmin = false;
  export let onOpenDeploy: () => void = () => {};

  const squadNetworkOptions = listSquadDeployNetworkOptions();
  let editingNetwork = false;
  let squadNetworkChoice: SupportedChainId | '' = squadNetwork ?? '';
  $: if (!editingNetwork) squadNetworkChoice = squadNetwork ?? '';

  $: myNpub = $currentUser?.npub ?? '';
  $: myRosterEvm = myNpub ? squadMemberEvmByNpub[myNpub]?.trim() : '';
  $: networkLabel = squadNetwork ? getWalletNetworkDisplayName(squadNetwork) : 'Not set';
  $: networkHint = squadNetworkFromInfra ? 'Locked to deployed infra' : '';

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
    <li class="checklist-item" class:done={hasSponsor}>
      {#if hasSponsor}
        <span class="check-mark" aria-hidden="true">✓</span>
        <span>Squad sponsor</span>
      {:else}
        <span class="check-todo" aria-hidden="true">○</span>
        <button type="button" class="checklist-action" on:click={onOpenDeploy}>Deploy squad sponsor</button>
      {/if}
    </li>
    <li class="checklist-item" class:done={hasGovernance}>
      {#if hasGovernance}
        <span class="check-mark" aria-hidden="true">✓</span>
        <span>Squad governance</span>
      {:else}
        <span class="check-todo" aria-hidden="true">○</span>
        <button type="button" class="checklist-action" on:click={onOpenDeploy}>Deploy Squad governance</button>
      {/if}
    </li>
    <li class="checklist-item" class:done={hasSquadAdmin}>
      {#if hasSquadAdmin}
        <span class="check-mark" aria-hidden="true">✓</span>
        <span>Squad admin</span>
      {:else}
        <span class="check-todo" aria-hidden="true">○</span>
        <button type="button" class="checklist-action" on:click={onOpenDeploy}>Deploy Squad admin</button>
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
