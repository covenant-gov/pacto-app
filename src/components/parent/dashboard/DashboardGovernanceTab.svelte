<script lang="ts">
  import { t } from 'svelte-i18n';
  import PactoGovGovernanceShell from '../governance/PactoGovGovernanceShell.svelte';
  import DashboardRolesTreeTab from './DashboardRolesTreeTab.svelte';
  import { resolveGovernanceProvider } from '../../../lib/governance/governance-provider';
  import type { HatTreeNodeDto, TreasuryProposalDto, SquadInfraDto } from '../../../lib/governance/api';
  import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';
  import type { DashboardStructureSummary } from '../../../lib/dashboard/structure-summary';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { parseSupportedChainId } from '../../../lib/wallet/chains';

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
    hasSponsor?: boolean;
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
    hasSponsor = false,
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

<section class="governance-section" aria-labelledby="governance-heading">
  <div class="governance-heading-row">
    <h3 id="governance-heading" class="section-heading">{$t('governance.governance.title')}</h3>
    {#if !archiveView}
      <button type="button" class="btn-primary governance-deploy-btn" onclick={onOpenLaunchpad}>
        {$t('governance.governance.deploy')}
      </button>
    {/if}
  </div>

  {#if showAbiModules}
    <p class="dashboard-placeholder-text muted">
      {$t('governance.governance.abiModules')}
    </p>
  {:else if showPactoGovShell && pactoPayload}
    <p class="gov-network muted">
      {$t('governance.governance.pactoGovOn', { values: { network: getWalletNetworkDisplayName(parseSupportedChainId(network)) } })}
    </p>
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
      {hasSponsor}
      {warGameStack}
      {archiveView}
      surface="commands"
    />
  {:else}
    <p class="dashboard-placeholder-text muted">
      {$t('governance.governance.placeholder')}
    </p>
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
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .section-heading {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .governance-deploy-btn {
    flex-shrink: 0;
  }

  .gov-network,
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
