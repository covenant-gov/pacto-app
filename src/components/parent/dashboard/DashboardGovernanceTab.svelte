<script lang="ts">
  import PactoGovGovernanceShell from '../governance/PactoGovGovernanceShell.svelte';
  import { resolveGovernanceProvider } from '../../../lib/governance/governance-provider';
  import type { TreasuryProposalDto, SquadInfraDto } from '../../../lib/governance/api';
  import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';
  import { getWalletNetworkDisplayName } from '../../../lib/wallet/assets';
  import { parseSupportedChainId } from '../../../lib/wallet/chains';
  import { isTreasuryProposalActive } from '../../../lib/governance/treasury-proposal-ui';

  export let squadInfraRows: SquadInfraDto[] | undefined = undefined;
  export let pactoPayload: PactoGovProviderPayloadV1 | null = null;
  export let pactoGovTopHatId = '';
  export let pactoGovChain: string | undefined = undefined;
  export let parentId = '';
  export let announcementsGroupId = '';
  export let myAddress = '';
  export let captainWearers: string[] = [];
  export let crewWearers: string[] = [];
  export let treasuryProposals: TreasuryProposalDto[] = [];
  export let treasuryProposalsLoading = false;
  export let treasuryProposalsRefreshing = false;
  export let treasuryProposalsError = '';
  export let proposalHasVotedById: Record<string, boolean> = {};
  export let onRefreshProposals: () => void = () => {};
  export let onOpenLaunchpad: () => void = () => {};
  export let onOpenCrew: () => void = () => {};

  $: provider = resolveGovernanceProvider(squadInfraRows);
  $: network = pactoGovChain ?? 'sepolia';
  $: openCount = treasuryProposals.filter((p) => isTreasuryProposalActive(p.status)).length;
</script>

<section class="governance-section" aria-labelledby="governance-heading">
  <div class="governance-heading-row">
    <h3 id="governance-heading" class="section-heading">Governance</h3>
    <button type="button" class="btn-primary governance-deploy-btn" on:click={onOpenLaunchpad}>
      Deploy
    </button>
  </div>

  {#if provider === 'none'}
    <p class="dashboard-placeholder-text muted">
      Deploy Pacto Gov from the launchpad to enable treasury proposals and governance actions.
    </p>
  {:else if provider === 'abi_modules'}
    <p class="dashboard-placeholder-text muted">
      Custom ABI governance modules are reserved for a future pathway. Use Pacto Gov or contract allowlist
      (Status) for now.
    </p>
  {:else if pactoPayload?.treasuryAuthority}
    <p class="gov-network muted">
      Pacto Gov on <strong>{getWalletNetworkDisplayName(parseSupportedChainId(network))}</strong>
      {#if openCount}
        · {openCount} open proposal{openCount === 1 ? '' : 's'}
      {/if}
    </p>
    {#if treasuryProposalsRefreshing}
      <p class="dashboard-refresh-note muted" role="status">Refreshing proposals…</p>
    {/if}
    <PactoGovGovernanceShell
      payload={pactoPayload}
      {network}
      {parentId}
      {announcementsGroupId}
      {myAddress}
      {captainWearers}
      {crewWearers}
      {treasuryProposals}
      {treasuryProposalsLoading}
      {treasuryProposalsError}
      {proposalHasVotedById}
      {onRefreshProposals}
      {onOpenCrew}
    />
  {:else}
    <p class="dashboard-placeholder-text muted">
      Deploy Pacto Gov from the launchpad to enable treasury proposals and governance actions.
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
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    border: none;
  }
</style>
