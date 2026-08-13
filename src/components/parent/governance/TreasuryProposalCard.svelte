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
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  export let proposal: TreasuryProposalDto;
  export let hasVoted: boolean | undefined = undefined;
  export let voterAddress = '';
  export let votePending = false;
  export let voteDisabledReason = '';
  export let onVoteYea: (() => void) | undefined = undefined;
  export let onVoteNay: (() => void) | undefined = undefined;

  const tFn = get(t);

  $: voteState = resolveProposalVoteUiState({ proposal, hasVoted, voterAddress });
  $: isActive = isTreasuryProposalActive(proposal.status);
  $: isPast = isTreasuryProposalPast(proposal.status);
  $: outcome = treasuryProposalOutcomeLabel(proposal.status);
  $: voteLocked = !!voteDisabledReason;

  function voteStateLabel(state: ProposalVoteUiState): string {
    switch (state) {
      case 'loading':
        return tFn('governance.proposal.voteStatus.loading');
      case 'no_evm':
        return tFn('governance.proposal.voteStatus.noEvm');
      case 'voted':
        return tFn('governance.proposal.voteStatus.voted');
      case 'not_voted':
        return tFn('governance.proposal.voteStatus.notVoted');
      default:
        return tFn('governance.proposal.voteStatus.unavailable');
    }
  }
</script>

<li class="proposal-card" class:proposal-card-active={isActive} class:proposal-card-past={isPast}>
  <div class="proposal-card-head">
    <span class="proposal-card-tool">{$t('governance.title.treasuryAuthority')}</span>
    <span class="proposal-card-status" class:proposal-card-status-active={isActive}>{treasuryProposalStatusLabel(proposal.status)}</span>
  </div>
  <p class="proposal-card-title">{$t('governance.proposal.title', { values: { id: proposal.proposalId } })}</p>
  {#if outcome && isPast}
    <p class="proposal-card-outcome">{outcome}</p>
  {/if}
  <p class="proposal-card-meta muted">
    {$t('governance.proposal.meta', { values: { yeas: proposal.yeas, nays: proposal.nays, snapshot: proposal.snapshot, deadline: new Date(proposal.deadline * 1000).toLocaleString() } })}
  </p>
  <p class="proposal-card-target muted">
    {$t('governance.proposal.target')} <code class="proposal-card-ref">{proposal.to}</code>
  </p>
  {#if isActive}
    <p class="proposal-vote-state muted">{voteStateLabel(voteState)}</p>
    {#if voteState === 'not_voted'}
      <div class="proposal-vote-actions">
        <button
          type="button"
          class="btn-primary proposal-vote-btn"
          disabled={votePending || voteLocked || !onVoteYea}
          title={voteLocked ? voteDisabledReason : tFn('governance.proposal.voteYea')}
          on:click={() => {
            if (!voteLocked) onVoteYea?.();
          }}
        >
          {tFn('governance.proposal.voteYea')}
        </button>
        <button
          type="button"
          class="btn-secondary proposal-vote-btn"
          disabled={votePending || voteLocked || !onVoteNay}
          title={voteLocked ? voteDisabledReason : tFn('governance.proposal.voteNay')}
          on:click={() => {
            if (!voteLocked) onVoteNay?.();
          }}
        >
          {tFn('governance.proposal.voteNay')}
        </button>
      </div>
      {#if voteLocked}
        <p class="proposal-vote-state muted">{voteDisabledReason}</p>
      {/if}
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
    border-color: var(--brand);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 25%, transparent);
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
    color: var(--brand);
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
