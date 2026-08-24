<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import PactoGovGovernanceShell from '../governance/PactoGovGovernanceShell.svelte';
  import { resolveGovernanceProvider } from '../../../lib/governance/governance-provider';
  import type { SquadInfraDto, TreasuryProposalDto } from '../../../lib/governance/api';
  import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';
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
  import { squadInfraByParentId } from '../../../stores/squads';
  import { pactoGovInfraRow, pactoGovWargameInfraRow } from '../../../lib/governance/api';
  import { hasSquadAdminInfra } from '../../../lib/governance/squad-admin-payload';
  import { syncSquadInfraForParent } from '../../../lib/dashboard/dashboard-data-sync';
  import { openSquadWargame } from '../../../lib/navigation/open-squad-dashboard';
  import { isActiveWarGameStack, warGameStatusAction } from '../../../lib/governance/war-game-payload';
  import DeployWarGameModal from '../governance/DeployWarGameModal.svelte';
  import { showToast } from '../../../stores/toast';
  import type { WarGameDeployComplete } from '../../../lib/governance/start-war-game-deploy';

  let {
    announcementsGroupId = null,
    parentId = '',
    channelMembers = [],
    squadMemberEvmByNpub = {},
    squadNetwork = null,
    hasGovernance = false,
    captainWearers = [],
    crewWearers = [],
    onOpenDeploy = () => {},
    onOpenCrewBootstrap = () => {},
    onSelectNetwork = () => {},
    practiceNetwork = null,
    squadInfraRows = undefined,
    pactoPayload = null,
    pactoGovChain = undefined,
    myAddress = '',
    memberEvmOptions = [],
    treasuryProposals = [],
    treasuryProposalsLoading = false,
    treasuryProposalsError = '',
    onRefreshProposals = () => {},
    warGameStack = false,
    archiveView = false,
    warGameRound = '',
  }: {
    announcementsGroupId?: string | null;
    parentId?: string;
    channelMembers?: string[];
    squadMemberEvmByNpub?: Record<string, string>;
    squadNetwork?: SupportedChainId | null;
    hasGovernance?: boolean;
    captainWearers?: string[];
    crewWearers?: string[];
    onOpenDeploy?: () => void;
    onOpenCrewBootstrap?: () => void;
    onSelectNetwork?: () => void;
    practiceNetwork?: SupportedChainId | null;
    squadInfraRows?: SquadInfraDto[];
    pactoPayload?: PactoGovProviderPayloadV1 | null;
    pactoGovChain?: string;
    myAddress?: string;
    memberEvmOptions?: { address: string; label: string }[];
    treasuryProposals?: TreasuryProposalDto[];
    treasuryProposalsLoading?: boolean;
    treasuryProposalsError?: string;
    onRefreshProposals?: () => void;
    warGameStack?: boolean;
    archiveView?: boolean;
    warGameRound?: string;
  } = $props();

  let rosterKeyNeeded = $state(false);
  let showWarGameDeploy = $state(false);

  const myNpub = $derived($currentUser?.npub ?? '');
  const displayEvmByNpub = $derived(squadMemberEvmForDisplay(squadMemberEvmByNpub, myNpub, rosterKeyNeeded));
  const shareEvmState = $derived(allMembersShareEvmState(channelMembers, displayEvmByNpub));
  const infraRows = $derived($squadInfraByParentId[parentId]);
  const productionGov = $derived(pactoGovInfraRow(infraRows) != null);
  const productionAdmin = $derived(hasSquadAdminInfra(infraRows));
  const govState = $derived(binaryInfraState(productionGov));
  const adminState = $derived(binaryInfraState(productionAdmin));
  const warGameRow = $derived(pactoGovWargameInfraRow(infraRows));
  const hasWarGame = $derived(
    warGameRow != null && isActiveWarGameStack(warGameRow.providerPayload),
  );
  const warGameAction = $derived(warGameStatusAction(hasWarGame, warGameStack));
  const rosterMemberOptions = $derived(
    channelMembers
      .map((npub) => {
        const address = displayEvmByNpub[npub]?.trim();
        if (!address) return null;
        return { address };
      })
      .filter((row): row is { address: string } => row != null),
  );
  const crewMintState = $derived(
    mintCrewHatsState({
      hasGovernance,
      channelMembers,
      squadMemberEvmByNpub: displayEvmByNpub,
      captainWearers,
      crewWearers,
    }),
  );
  const liveProvider = $derived(resolveGovernanceProvider(squadInfraRows));
  const showPactoGovShell = $derived(
    Boolean(pactoPayload?.treasuryAuthority?.trim()) && (warGameStack || liveProvider === 'pacto_gov'),
  );
  const govNetwork = $derived(pactoGovChain ?? 'sepolia');

  $effect(() => {
    const pid = parentId;
    const gid = announcementsGroupId;
    if (!pid) return;
    void needsSquadRosterKeyChoice(pid, gid).then((needed) => {
      if (parentId !== pid) return;
      rosterKeyNeeded = needed;
    });
  });

  async function handleWarGameComplete(out: WarGameDeployComplete): Promise<void> {
    await syncSquadInfraForParent(parentId.trim());
    if (out.retiredSponsor) {
      showToast(get(t)('governance.deployWarGame.retiredToast'));
    }
    openSquadWargame(parentId);
  }

  function glyphClass(state: ChecklistItemState): string {
    if (state === 'done') return 'check-mark';
    if (state === 'pending') return 'check-pending';
    return 'check-todo';
  }
</script>

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
    <li class="checklist-item" class:done={hasWarGame}>
      <span class={glyphClass(hasWarGame ? 'done' : 'not_started')} aria-hidden="true"
        >{checklistGlyph(hasWarGame ? 'done' : 'not_started')}</span
      >
      {#if warGameAction === 'open'}
        <span>{$t('governance.status.wargameDeployed')}</span>
        <button type="button" class="checklist-action" onclick={() => openSquadWargame(parentId)}>
          {$t('governance.status.openWargame')}
        </button>
      {:else if warGameAction === 'redeploy'}
        <span>{$t('governance.status.wargameDeployed')}</span>
        <button type="button" class="checklist-action" onclick={() => (showWarGameDeploy = true)}>
          {$t('governance.status.redeployWargame')}
        </button>
      {:else}
        <button type="button" class="checklist-action" onclick={() => (showWarGameDeploy = true)}>
          {$t('governance.status.deployWargame')}
        </button>
      {/if}
    </li>
    {#if !warGameStack}
      <li class="checklist-item" class:done={govState === 'done'}>
        <span class={glyphClass(govState)} aria-hidden="true">{checklistGlyph(govState)}</span>
        {#if productionGov}
          <span>{$t('governance.status.squadGovernance')}</span>
        {:else}
          <button type="button" class="checklist-action" onclick={onOpenDeploy}>{$t('governance.status.deploySquadGovernance')}</button>
        {/if}
      </li>
      <li class="checklist-item" class:done={adminState === 'done'}>
        <span class={glyphClass(adminState)} aria-hidden="true">{checklistGlyph(adminState)}</span>
        {#if productionAdmin}
          <span>{$t('governance.status.squadAdmin')}</span>
        {:else}
          <button type="button" class="checklist-action" onclick={onOpenDeploy}>{$t('governance.status.deploySquadAdmin')}</button>
        {/if}
      </li>
    {/if}
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

{#if showPactoGovShell && pactoPayload}
  <PactoGovGovernanceShell
    payload={pactoPayload}
    network={govNetwork}
    {parentId}
    {myAddress}
    {captainWearers}
    {crewWearers}
    {memberEvmOptions}
    {treasuryProposals}
    {treasuryProposalsLoading}
    {treasuryProposalsError}
    {onRefreshProposals}
    {warGameStack}
    {archiveView}
    {warGameRound}
    surface="proposals"
  />
{/if}

{#if showWarGameDeploy}
  <DeployWarGameModal
    {parentId}
    {announcementsGroupId}
    practiceNetwork={practiceNetwork ?? undefined}
    redeploy={hasWarGame}
    memberOptions={rosterMemberOptions}
    onClose={() => (showWarGameDeploy = false)}
    onComplete={handleWarGameComplete}
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
    flex-wrap: wrap;
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
