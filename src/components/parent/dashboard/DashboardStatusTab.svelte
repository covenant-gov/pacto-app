<script lang="ts">
  import { t } from 'svelte-i18n';
  import SquadBroadcastSettingsSection from './SquadBroadcastSettingsSection.svelte';
  import SquadIdentitySection from './SquadIdentitySection.svelte';
  import type { Squad } from '../../../stores/squads';
  import { currentUser } from '../../../stores/auth';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import {
    needsSquadRosterKeyChoice,
    squadMemberEvmForDisplay,
  } from '../../../lib/squad/squad-roster-key-choice';
  import {
    allMembersShareEvmState,
    binaryInfraState,
    checklistGlyph,
    mintCrewHatsState,
    type ChecklistItemState,
  } from '../../../lib/governance/squad-sponsor-crew';

  let {
    squad,
    announcementsGroupId = null,
    parentId = '',
    channelMembers = [],
    squadMemberEvmByNpub = {},
    squadNetwork = null,
    hasGovernance = false,
    hasSquadAdmin = false,
    captainWearers = [],
    crewWearers = [],
    onOpenDeploy = () => {},
    onOpenCrewBootstrap = () => {},
    onSelectNetwork = () => {},
  }: {
    squad: Squad;
    announcementsGroupId?: string | null;
    parentId?: string;
    channelMembers?: string[];
    squadMemberEvmByNpub?: Record<string, string>;
    squadNetwork?: SupportedChainId | null;
    hasGovernance?: boolean;
    hasSquadAdmin?: boolean;
    captainWearers?: string[];
    crewWearers?: string[];
    onOpenDeploy?: () => void;
    onOpenCrewBootstrap?: () => void;
    onSelectNetwork?: () => void;
  } = $props();

  let rosterKeyNeeded = $state(false);

  const myNpub = $derived($currentUser?.npub ?? '');
  const displayEvmByNpub = $derived(squadMemberEvmForDisplay(squadMemberEvmByNpub, myNpub, rosterKeyNeeded));
  const shareEvmState = $derived(allMembersShareEvmState(channelMembers, displayEvmByNpub));
  const govState = $derived(binaryInfraState(hasGovernance));
  const adminState = $derived(binaryInfraState(hasSquadAdmin));
  const crewMintState = $derived(
    mintCrewHatsState({
      hasGovernance,
      channelMembers,
      squadMemberEvmByNpub: displayEvmByNpub,
      captainWearers,
      crewWearers,
    }),
  );

  $effect(() => {
    const pid = parentId;
    const gid = announcementsGroupId;
    if (!pid) return;
    void needsSquadRosterKeyChoice(pid, gid).then((needed) => {
      if (parentId !== pid) return;
      rosterKeyNeeded = needed;
    });
  });

  function glyphClass(state: ChecklistItemState): string {
    if (state === 'done') return 'check-mark';
    if (state === 'pending') return 'check-pending';
    return 'check-todo';
  }
</script>

<SquadIdentitySection {squad} />

<section class="status-checklist" aria-label={$t('governance.status.checklistAria')}>
  <span class="meta-label">{$t('governance.status.checklistTitle')}</span>
  <ul class="checklist" role="list">
    <li class="checklist-item" class:done={!!squadNetwork}>
      <span class={glyphClass(squadNetwork ? 'done' : 'not_started')} aria-hidden="true"
        >{checklistGlyph(squadNetwork ? 'done' : 'not_started')}</span
      >
      {#if squadNetwork}
        <span>{$t('governance.status.networkSelected', { values: { network: getWalletNetworkDisplayName(squadNetwork) } })}</span>
      {:else}
        <button type="button" class="checklist-action" onclick={onSelectNetwork}>
          {$t('governance.status.selectNetwork')}
        </button>
      {/if}
    </li>
    <li class="checklist-item" class:done={shareEvmState === 'done'}>
      <span class={glyphClass(shareEvmState)} aria-hidden="true">{checklistGlyph(shareEvmState)}</span>
      <span>{$t('governance.status.allMembersShareEvm')}</span>
    </li>
    <li class="checklist-item" class:done={govState === 'done'}>
      <span class={glyphClass(govState)} aria-hidden="true">{checklistGlyph(govState)}</span>
      {#if hasGovernance}
        <span>{$t('governance.status.squadGovernance')}</span>
      {:else}
        <button type="button" class="checklist-action" onclick={onOpenDeploy}>{$t('governance.status.deploySquadGovernance')}</button>
      {/if}
    </li>
    <li class="checklist-item" class:done={adminState === 'done'}>
      <span class={glyphClass(adminState)} aria-hidden="true">{checklistGlyph(adminState)}</span>
      {#if hasSquadAdmin}
        <span>{$t('governance.status.squadAdmin')}</span>
      {:else}
        <button type="button" class="checklist-action" onclick={onOpenDeploy}>{$t('governance.status.deploySquadAdmin')}</button>
      {/if}
    </li>
    <li class="checklist-item" class:done={crewMintState === 'done'}>
      <span class={glyphClass(crewMintState)} aria-hidden="true">{checklistGlyph(crewMintState)}</span>
      {#if crewMintState === 'done'}
        <span>{$t('governance.status.mintCrewHats')}</span>
      {:else if hasGovernance}
        <button type="button" class="checklist-action" onclick={onOpenCrewBootstrap}
          >{$t('governance.status.mintCrewHats')}</button
        >
      {:else}
        <span>{$t('governance.status.mintCrewHats')}</span>
      {/if}
    </li>
  </ul>
</section>

<SquadBroadcastSettingsSection {squad} />

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
</style>
