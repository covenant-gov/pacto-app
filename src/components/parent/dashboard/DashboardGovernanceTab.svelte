<script lang="ts">
  import { t } from 'svelte-i18n';
  import PactoGovGovernanceShell from '../governance/PactoGovGovernanceShell.svelte';
  import { resolveGovernanceProvider } from '../../../lib/governance/governance-provider';
  import type { TreasuryProposalDto, SquadInfraDto } from '../../../lib/governance/api';
  import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { parseSupportedChainId } from '../../../lib/wallet/chains';
  import { isTreasuryProposalActive } from '../../../lib/governance/treasury-proposal-ui';

  export let squadInfraRows: SquadInfraDto[] | undefined = undefined;
  export let pactoPayload: PactoGovProviderPayloadV1 | null = null;
  export let pactoGovChain: string | undefined = undefined;
  export let parentId = '';
  export let myAddress = '';
  export let captainWearers: string[] = [];
  export let crewWearers: string[] = [];
  export let memberEvmOptions: { address: string; label: string }[] = [];
  export let treasuryProposals: TreasuryProposalDto[] = [];
  export let treasuryProposalsLoading = false;
  export let treasuryProposalsRefreshing = false;
  export let treasuryProposalsError = '';
  export let onRefreshProposals: () => void = () => {};
  export let onOpenLaunchpad: () => void = () => {};
  export let hasSponsor = false;
  export let warGameStack = false;

  $: liveProvider = resolveGovernanceProvider(squadInfraRows);
  $: showPactoGovShell = Boolean(pactoPayload?.treasuryAuthority?.trim()) && (
    warGameStack || liveProvider === 'pacto_gov'
  );
  $: showAbiModules = !warGameStack && liveProvider === 'abi_modules';
  $: network = pactoGovChain ?? 'sepolia';
  $: openCount = treasuryProposals.filter((p) => isTreasuryProposalActive(p.status)).length;
</script>

<section class="governance-section" aria-labelledby="governance-heading">
  <div class="governance-heading-row">
    <h3 id="governance-heading" class="section-heading">{$t('governance.governance.title')}</h3>
    <button type="button" class="btn-primary governance-deploy-btn" onclick={onOpenLaunchpad}>
      {$t('governance.governance.deploy')}
    </button>
  </div>

  {#if showAbiModules}
    <p class="dashboard-placeholder-text muted">
      {$t('governance.governance.abiModules')}
    </p>
  {:else if showPactoGovShell && pactoPayload}
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
      {warGameStack}
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
