<script lang="ts">
  import type { TreasuryProposalDto } from '$lib/governance/api';
  import { treasuryProposalStatusLabel } from '$lib/governance/pacto-gov-payload';
  import {
    isTreasuryProposalActive,
    isTreasuryProposalPast,
    treasuryProposalOutcomeLabel,
  } from '$lib/governance/treasury-proposal-ui';
  import { executableTreasuryProposals } from '$lib/governance/gov-proposal-lists';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  export let proposal: TreasuryProposalDto;
  export let showExecute = false;
  export let executePending = false;
  export let executeDisabledReason = '';
  export let onExecute: (() => void) | undefined = undefined;

  const tFn = get(t);

  $: isActive = isTreasuryProposalActive(proposal.status);
  $: isPast = isTreasuryProposalPast(proposal.status);
  $: outcome = treasuryProposalOutcomeLabel(proposal.status);
  $: isExecutable = executableTreasuryProposals([proposal]).length > 0;
</script>

<li
  class="proposal-card"
  class:proposal-card-active={isActive}
  class:proposal-card-past={isPast}
  class:proposal-card-executable={isExecutable}
>
  <div class="proposal-card-head">
    <span class="proposal-card-tool">{$t('governance.title.treasuryAuthority')}</span>
    <span class="proposal-card-status" class:proposal-card-status-active={isActive}>
      {treasuryProposalStatusLabel(proposal.status)}
    </span>
  </div>
  <p class="proposal-card-title">{$t('governance.proposal.title', { values: { id: proposal.proposalId } })}</p>
  {#if outcome && isPast}
    <p class="proposal-card-outcome">{outcome}</p>
  {/if}
  <p class="proposal-card-meta muted">
    {$t('governance.proposal.meta', { values: { yeas: proposal.yeas, nays: proposal.nays, snapshot: proposal.snapshot, deadline: new Date(proposal.deadline * 1000).toLocaleString() } })}
  </p>
  {#if proposal.captainApproved}
    <p class="proposal-card-meta muted">{$t('governance.proposal.captainApproved')}</p>
  {:else if proposal.captainDefeated}
    <p class="proposal-card-meta muted">{$t('governance.proposal.captainVetoed')}</p>
  {/if}
  <p class="proposal-card-target muted">
    {$t('governance.proposal.target')} <code class="proposal-card-ref">{proposal.to}</code>
  </p>
  {#if showExecute && isExecutable && onExecute}
    <button
      type="button"
      class="execute-btn"
      disabled={executePending || !!executeDisabledReason}
      title={executeDisabledReason || tFn('governance.proposal.execute')}
      on:click={() => onExecute()}
    >
      {tFn('governance.action.execute')}
    </button>
  {/if}
</li>

<style>
  .proposal-card {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 12px;
    background: var(--bg-elevated);
    list-style: none;
  }
  .proposal-card-active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
  }
  .proposal-card-executable {
    border-color: color-mix(in srgb, #16a34a 55%, var(--border-subtle));
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
  .proposal-card-target {
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
  .execute-btn {
    margin-top: 4px;
    font-size: 0.8125rem;
    padding: 6px 12px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    background: #16a34a;
    color: #fff;
  }
  .execute-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
