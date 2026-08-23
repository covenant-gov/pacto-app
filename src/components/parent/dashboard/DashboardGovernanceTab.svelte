<script lang="ts">
  import { t } from 'svelte-i18n';
  import PactoGovGovernanceShell from '../governance/PactoGovGovernanceShell.svelte';
  import DashboardRolesTreeTab from './DashboardRolesTreeTab.svelte';
  import { resolveGovernanceProvider } from '../../../lib/governance/governance-provider';
  import type { HatTreeNodeDto, TreasuryProposalDto, SquadInfraDto } from '../../../lib/governance/api';
  import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';
  import type { DashboardStructureSummary } from '../../../lib/dashboard/structure-summary';

  interface Props {
    squadInfraRows?: SquadInfraDto[];
    pactoPayload?: PactoGovProviderPayloadV1 | null;
    pactoGovChain?: string;
    parentId?: string;
    myAddress?: string;
    captainWearers?: string[];
    crewWearers?: string[];
    memberEvmOptions?: { address: string; label: string }[];
    treasuryProposals?: TreasuryProposalDto[];
    treasuryProposalsLoading?: boolean;
    treasuryProposalsRefreshing?: boolean;
    treasuryProposalsError?: string;
    onRefreshProposals?: () => void;
    onOpenLaunchpad?: () => void;
    warGameStack?: boolean;
    archiveView?: boolean;
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
  }

  let {
    squadInfraRows = undefined,
    pactoPayload = null,
    pactoGovChain = undefined,
    parentId = '',
    myAddress = '',
    captainWearers = [],
    crewWearers = [],
    memberEvmOptions = [],
    treasuryProposals = [],
    treasuryProposalsLoading = false,
    treasuryProposalsRefreshing = false,
    treasuryProposalsError = '',
    onRefreshProposals = () => {},
    onOpenLaunchpad = () => {},
    warGameStack = false,
    archiveView = false,
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
  }: Props = $props();

  const liveProvider = $derived(resolveGovernanceProvider(squadInfraRows));
  const showPactoGovShell = $derived(
    Boolean(pactoPayload?.treasuryAuthority?.trim()) && (warGameStack || liveProvider === 'pacto_gov'),
  );
  const showAbiModules = $derived(!warGameStack && liveProvider === 'abi_modules');
  const network = $derived(pactoGovChain ?? 'sepolia');
</script>

<section class="governance-section" aria-label={$t('governance.governance.title')}>
  {#if !archiveView && !showPactoGovShell && !showAbiModules}
    <div class="governance-heading-row">
      <button type="button" class="btn-primary governance-deploy-btn" onclick={onOpenLaunchpad}>
        {$t('governance.governance.deploy')}
      </button>
    </div>
  {/if}

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
      {memberEvmOptions}
      {treasuryProposals}
      {treasuryProposalsLoading}
      {treasuryProposalsError}
      {onRefreshProposals}
      {warGameStack}
      {archiveView}
      surface="commands"
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
  />
</section>

<style>
  .governance-section {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .governance-heading-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
  }

  .governance-deploy-btn {
    flex-shrink: 0;
  }

  .dashboard-placeholder-text,
  .dashboard-refresh-note,
  .muted {
    margin: 0 0 12px;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .btn-primary {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.875rem;
    cursor: pointer;
    background: var(--brand);
    color: var(--on-brand);
    border: none;
  }
</style>
