<script lang="ts">
  import { t } from 'svelte-i18n';
  import PactoGovGovernanceShell from '../governance/PactoGovGovernanceShell.svelte';
  import DashboardRolesTreeTab from './DashboardRolesTreeTab.svelte';
  import { resolveGovernanceProvider } from '../../../lib/governance/governance-provider';
  import type { HatTreeNodeDto, TreasuryProposalDto, SquadInfraDto } from '../../../lib/governance/api';
  import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';
  import type { DashboardStructureSummary } from '../../../lib/dashboard/structure-summary';
  import type { HatsTreeCommandContext } from '../../../lib/governance/hats-tree-role-actions';

  interface Props {
    squadInfraRows?: SquadInfraDto[];
    pactoPayload?: PactoGovProviderPayloadV1 | null;
    pactoGovChain?: string;
    parentId?: string;
    myAddress?: string;
    captainWearers?: string[];
    crewWearers?: string[];
    memberOptionsLoading?: boolean;
    memberEvmOptions?: { address: string; label: string }[];
    treasuryProposals?: TreasuryProposalDto[];
    treasuryProposalsLoading?: boolean;
    treasuryProposalsRefreshing?: boolean;
    treasuryProposalsError?: string;
    onRefreshProposals?: () => void;
    onOpenLaunchpad?: () => void;
    warGameStack?: boolean;
    archiveView?: boolean;
    warGameRound?: string;
    structureSummary?: DashboardStructureSummary | null;
    hatsTree?: HatTreeNodeDto | null;
    hatsTreeLoading?: boolean;
    hatsTreeRefreshing?: boolean;
    hatsTreeError?: string;
    roleLabelByHatId?: Record<string, string>;
    wearerAddressesByHatId?: Record<string, string[]>;
    executorRolesByAddress?: Record<string, string>;
    squadMemberEvmByNpub?: Record<string, string>;
    rolesTreeAnnotationsLoading?: boolean;
    rolesTreeAnnotationsRefreshing?: boolean;
    rolesTreeAnnotationsError?: string;
    onRefreshRolesTree?: () => void;
    knownWearerLabels?: Record<string, string>;
    hatsHistoryUnavailable?: boolean;
  }

  let {
    squadInfraRows = undefined,
    pactoPayload = null,
    pactoGovChain = undefined,
    parentId = '',
    myAddress = '',
    captainWearers = [],
    crewWearers = [],
    memberOptionsLoading = false,
    memberEvmOptions = [],
    treasuryProposals = [],
    treasuryProposalsLoading = false,
    treasuryProposalsRefreshing = false,
    treasuryProposalsError = '',
    onRefreshProposals = () => {},
    onOpenLaunchpad = () => {},
    warGameStack = false,
    archiveView = false,
    warGameRound = '',
    structureSummary = undefined,
    hatsTree = null,
    hatsTreeLoading = false,
    hatsTreeRefreshing = false,
    hatsTreeError = '',
    roleLabelByHatId = {},
    wearerAddressesByHatId = {},
    executorRolesByAddress = {},
    squadMemberEvmByNpub = {},
    rolesTreeAnnotationsLoading = false,
    rolesTreeAnnotationsRefreshing = false,
    rolesTreeAnnotationsError = '',
    onRefreshRolesTree = () => {},
    knownWearerLabels = {},
    hatsHistoryUnavailable = false,
  }: Props = $props();

  const liveProvider = $derived(resolveGovernanceProvider(squadInfraRows));
  const showPactoGovShell = $derived(
    Boolean(pactoPayload?.treasuryAuthority?.trim()) && (warGameStack || liveProvider === 'pacto_gov'),
  );
  const showAbiModules = $derived(!warGameStack && liveProvider === 'abi_modules');
  const network = $derived(pactoGovChain ?? 'sepolia');
  let treeCommands = $state<HatsTreeCommandContext | null>(null);
</script>

<section class="governance-section" aria-label={$t('governance.governance.title')}>
  {#if showAbiModules}
    <p class="dashboard-placeholder-text muted">
      {$t('governance.governance.abiModules')}
    </p>
  {:else if showPactoGovShell && pactoPayload}
    {#if treasuryProposalsRefreshing}
      <p class="dashboard-refresh-note muted" role="status">{$t('governance.governance.refreshing')}</p>
    {/if}
    <PactoGovGovernanceShell
      payload={pactoPayload}
      {network}
      {parentId}
      {myAddress}
      {captainWearers}
      {crewWearers}
      {memberOptionsLoading}
      {memberEvmOptions}
      {treasuryProposals}
      {treasuryProposalsLoading}
      {treasuryProposalsError}
      {onRefreshProposals}
      {warGameStack}
      {archiveView}
      {warGameRound}
      surface="commands"
      bind:treeCommands
    />
  {/if}

  <DashboardRolesTreeTab
    {squadInfraRows}
    {structureSummary}
    {hatsTree}
    {hatsTreeLoading}
    {hatsTreeRefreshing}
    {hatsTreeError}
    {roleLabelByHatId}
    {wearerAddressesByHatId}
    {executorRolesByAddress}
    {squadMemberEvmByNpub}
    {rolesTreeAnnotationsLoading}
    {rolesTreeAnnotationsRefreshing}
    {rolesTreeAnnotationsError}
    {onRefreshRolesTree}
    {onOpenLaunchpad}
    {knownWearerLabels}
    viewerAddress={myAddress}
    {hatsHistoryUnavailable}
    commandContext={showPactoGovShell ? treeCommands : null}
  />
</section>

<style>
  .governance-section {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .dashboard-placeholder-text,
  .dashboard-refresh-note,
  .muted {
    margin: 0 0 12px;
    font-size: 0.875rem;
    color: var(--text-muted);
  }
</style>
