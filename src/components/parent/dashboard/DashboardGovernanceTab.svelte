<script lang="ts">
  import { t } from 'svelte-i18n';
  import PactoGovGovernanceShell from '../governance/PactoGovGovernanceShell.svelte';
  import { resolveGovernanceProvider } from '../../../lib/governance/governance-provider';
  import type { TreasuryProposalDto, SquadInfraDto } from '../../../lib/governance/api';
  import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { parseSupportedChainId } from '../../../lib/wallet/chains';
  import { isTreasuryProposalActive } from '../../../lib/governance/treasury-proposal-ui';

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
  }: Props = $props();

  const provider = $derived(resolveGovernanceProvider(squadInfraRows));
  const network = $derived(pactoGovChain ?? 'sepolia');
  const openCount = $derived(treasuryProposals.filter((p) => isTreasuryProposalActive(p.status)).length);
</script>

<section class="governance-section" aria-labelledby="governance-heading">
  <div class="governance-heading-row">
    <h3 id="governance-heading" class="section-heading">{$t('governance.governance.title')}</h3>
    <button type="button" class="btn-primary governance-deploy-btn" onclick={onOpenLaunchpad}>
      {$t('governance.governance.deploy')}
    </button>
  </div>

  {#if provider === 'none'}
    <p class="dashboard-placeholder-text muted">
      {$t('governance.governance.placeholder')}
    </p>
  {:else if provider === 'abi_modules'}
    <p class="dashboard-placeholder-text muted">
      {$t('governance.governance.abiModules')}
    </p>
  {:else if pactoPayload?.treasuryAuthority}
    <p class="gov-network muted">
      {$t('governance.governance.pactoGovOn', { values: { network: getWalletNetworkDisplayName(parseSupportedChainId(network)) } })}
      {#if openCount}
        · {$t('governance.governance.openProposals', { values: { count: openCount } })}
      {/if}
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
    />
  {:else}
    <p class="dashboard-placeholder-text muted">
      {$t('governance.governance.placeholder')}
    </p>
  {/if}
</section>

<style>
  .governance-section {
    min-width: 0;
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
