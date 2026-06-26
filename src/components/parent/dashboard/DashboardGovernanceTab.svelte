<script lang="ts">
  import TreasuryProposalCard from '../governance/TreasuryProposalCard.svelte';
  import type { TreasuryProposalDto } from '../../../lib/governance/api';
  import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';

  export let squadInfraRows: unknown[] | undefined = undefined;
  export let hasSponsor = false;
  export let pactoPayload: PactoGovProviderPayloadV1 | null = null;
  export let treasuryProposals: TreasuryProposalDto[] = [];
  export let treasuryProposalsLoading = false;
  export let treasuryProposalsRefreshing = false;
  export let treasuryProposalsError = '';
  export let myVoterAddress = '';
  export let proposalHasVotedById: Record<string, boolean> = {};
  export let proposalVotesLoading = false;
  export let onTreasuryVoteClick: () => void = () => {};
  export let onOpenLaunchpad: () => void = () => {};
</script>

{#if squadInfraRows !== undefined && !hasSponsor}
  <div class="sponsor-empty-banner" role="status">
    <p class="sponsor-empty-banner-text">
      Deploy squad sponsor first — it funds gas sponsorship and unlocks Pacto Gov and Safe deploy paths.
    </p>
    <button type="button" class="btn-primary" on:click={onOpenLaunchpad}>Open Deploy</button>
  </div>
{/if}
<section class="dashboard-section dashboard-placeholder-section" aria-labelledby="governance-heading">
  <h3 id="governance-heading" class="section-heading">Governance</h3>
  {#if !pactoPayload?.treasuryAuthority}
    <p class="dashboard-placeholder-text dashboard-placeholder-lead">
      Treasury Authority proposals appear here after you deploy <strong>Pacto Gov</strong> from Deploy.
    </p>
    <button type="button" class="btn-primary governance-deploy-cta" on:click={onOpenLaunchpad}>Deploy Pacto Gov</button>
  {:else}
    {#if treasuryProposalsRefreshing}
      <p class="dashboard-refresh-note muted" role="status">Refreshing proposals…</p>
    {/if}
    {#if treasuryProposalsError && treasuryProposals.length > 0}
      <p class="chain-read-error" role="alert">{treasuryProposalsError}</p>
    {/if}
    {#if treasuryProposalsLoading && treasuryProposals.length === 0}
      <p class="dashboard-placeholder-text muted">Loading treasury proposals…</p>
    {:else if treasuryProposals.length === 0 && treasuryProposalsError}
      <p class="chain-read-error" role="alert">{treasuryProposalsError}</p>
    {:else if treasuryProposals.length === 0}
      <p class="dashboard-placeholder-text muted">No treasury proposals on-chain yet for this deployment.</p>
    {:else}
      <ul class="proposal-card-list" role="list">
        {#each treasuryProposals as proposal (proposal.proposalId)}
          <TreasuryProposalCard
            {proposal}
            voterAddress={myVoterAddress}
            hasVoted={proposalHasVotedById[proposal.proposalId]}
            votePending={proposalVotesLoading}
            onVoteYea={onTreasuryVoteClick}
            onVoteNay={onTreasuryVoteClick}
          />
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .sponsor-empty-banner {
    margin: 0 16px 16px;
    padding: 14px 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-elevated);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
  }

  .sponsor-empty-banner-text {
    margin: 0;
    flex: 1;
    min-width: 200px;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .dashboard-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
  }

  .dashboard-placeholder-section .section-heading {
    margin-bottom: 8px;
  }

  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 12px 0;
  }

  .dashboard-placeholder-text {
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0 0 12px 0;
  }

  .dashboard-placeholder-lead {
    margin-bottom: 16px;
  }

  .dashboard-placeholder-text.muted,
  .muted {
    color: var(--text-muted);
  }

  .governance-deploy-cta {
    margin-top: 8px;
  }

  .proposal-card-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
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
