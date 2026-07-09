<script lang="ts">
  import type { TreasuryProposalDto } from '$lib/governance/api';
  import { treasuryProposalStatusLabel } from '$lib/governance/pacto-gov-payload';
  import {
    isTreasuryProposalActive,
    isTreasuryProposalPast,
    resolveProposalVoteUiState,
    treasuryProposalOutcomeLabel,
    type ProposalVoteUiState,
  } from '$lib/governance/treasury-proposal-ui';

  export let proposal: TreasuryProposalDto;
  export let hasVoted: boolean | undefined = undefined;
  export let voterAddress = '';
  export let votePending = false;
  export let onVoteYea: (() => void) | undefined = undefined;
  export let onVoteNay: (() => void) | undefined = undefined;

  $: voteState = resolveProposalVoteUiState({ proposal, hasVoted, voterAddress });
  $: isActive = isTreasuryProposalActive(proposal.status);
  $: isPast = isTreasuryProposalPast(proposal.status);
  $: outcome = treasuryProposalOutcomeLabel(proposal.status);

  function voteStateLabel(state: ProposalVoteUiState): string {
    switch (state) {
      case 'loading':
        return 'Checking your vote…';
      case 'no_evm':
        return 'Share your squad EVM address to vote';
      case 'voted':
        return 'You voted on this proposal';
      case 'not_voted':
        return 'You have not voted yet';
      default:
        return 'Vote status unavailable';
    }
  }
</script>

<li class="proposal-card" class:proposal-card-active={isActive} class:proposal-card-past={isPast}>
  <div class="proposal-card-head">
    <span class="proposal-card-tool">Treasury Authority</span>
    <span class="proposal-card-status" class:proposal-card-status-active={isActive}>{treasuryProposalStatusLabel(proposal.status)}</span>
  </div>
  <p class="proposal-card-title">Proposal #{proposal.proposalId}</p>
  {#if outcome && isPast}
    <p class="proposal-card-outcome">{outcome}</p>
  {/if}
  <p class="proposal-card-meta muted">
    Yeas {proposal.yeas} / nays {proposal.nays} · snapshot {proposal.snapshot} · deadline 
    {new Date(proposal.deadline * 1000).toLocaleString()}
  </p>
  <p class="proposal-card-target muted">
    Target <code class="proposal-card-ref">{proposal.to}</code>
  </p>
  {#if isActive}
    <p class="proposal-vote-state muted">{voteStateLabel(voteState)}</p>
    {#if voteState === 'not_voted'}
      <div class="proposal-vote-actions">
        <button
          type="button"
          class="btn-primary proposal-vote-btn"
          disabled={votePending || !onVoteYea}
          on:click={() => onVoteYea?.()}
        >
          Vote yea
        </button>
        <button
          type="button"
          class="btn-secondary proposal-vote-btn"
          disabled={votePending || !onVoteNay}
          on:click={() => onVoteNay?.()}
        >
          Vote nay
        </button>
      </div>
    {/if}
  {/if}
</li>

<style>
  .proposal-card {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 12px;
    background: var(--bg-elevated);
  }

  .proposal-card-active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
  }

  .proposal-card-past {
    opacity: 0.92;
  }

  .proposal-card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .proposal-card-tool {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .proposal-card-status {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .proposal-card-status-active {
    color: var(--accent);
    font-weight: 600;
  }

  .proposal-card-title {
    margin: 0 0 6px 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .proposal-card-outcome {
    margin: 0 0 6px 0;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .proposal-card-meta,
  .proposal-card-target,
  .proposal-vote-state {
    font-size: 0.8125rem;
    line-height: 1.45;
    margin: 0 0 8px 0;
  }

  .proposal-card-ref {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    word-break: break-all;
  }

  .muted {
    color: var(--text-muted);
  }

  .proposal-vote-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }

  .proposal-vote-btn {
    font-size: 0.8125rem;
    padding: 6px 12px;
  }
</style>
