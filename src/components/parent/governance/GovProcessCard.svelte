<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { GovProcessCard } from '../../../lib/governance/gov-process';
  import { govProcessToolLabel } from '../../../lib/governance/gov-process';
  import { govExecuteUiState } from '../../../lib/governance/gov-execute-ui';
  import { treasuryProposalStatusLabel } from '../../../lib/governance/pacto-gov-payload';
  import {
    isTreasuryProposalActive,
    isTreasuryProposalPast,
    treasuryProposalOutcomeLabel,
  } from '../../../lib/governance/treasury-proposal-ui';
  import { executableTreasuryProposals, isMutinyExecutable } from '../../../lib/governance/gov-proposal-lists';
  import ProposalActionSummary from './ProposalActionSummary.svelte';

  export let card: GovProcessCard;
  export let showExecute = false;
  export let executePending = false;
  /** Privilege gate i18n key (empty when allowed). Delay lock is derived from the card. */
  export let privilegeReasonKey = '';
  export let onExecute: (() => void) | undefined = undefined;

  let delayElapsed = false;
  let unlockTimer: ReturnType<typeof setTimeout> | null = null;

  function clearUnlockTimer() {
    if (unlockTimer != null) {
      clearTimeout(unlockTimer);
      unlockTimer = null;
    }
  }

  onDestroy(clearUnlockTimer);

  $: tool = $t(govProcessToolLabel(card));
  $: isActive =
    card.kind === 'treasury' ? isTreasuryProposalActive(card.proposal.status) : true;
  $: isPast = card.kind === 'treasury' ? isTreasuryProposalPast(card.proposal.status) : false;
  $: cardUnlockAtSec =
    card.kind === 'crew_add' || card.kind === 'crew_remove'
      ? card.executableAt > 0
        ? card.executableAt
        : null
      : null;
  $: {
    clearUnlockTimer();
    const alreadyOpen = cardUnlockAtSec == null || cardUnlockAtSec <= Math.floor(Date.now() / 1000);
    delayElapsed = alreadyOpen;
    if (!alreadyOpen && cardUnlockAtSec != null) {
      unlockTimer = setTimeout(() => {
        delayElapsed = true;
      }, Math.max(0, cardUnlockAtSec * 1000 - Date.now()));
    }
  }
  $: execUi = govExecuteUiState({
    card,
    privilegeReasonKey,
    nowSec: delayElapsed ? Math.floor(Date.now() / 1000) : 0,
  });
  $: isExecutable =
    card.kind === 'treasury'
      ? executableTreasuryProposals([card.proposal]).length > 0
      : card.kind === 'mutiny'
        ? isMutinyExecutable(card.status)
        : card.status === 'executable';
  $: title =
    card.kind === 'treasury'
      ? $t('governance.proposal.title', { values: { id: card.proposal.proposalId } })
      : card.kind === 'mutiny'
        ? $t('governance.proposal.mutinyTitle', { values: { id: card.status.activeMutinyId } })
        : card.kind === 'crew_add'
          ? $t('governance.proposal.addCrewTitle')
          : $t('governance.proposal.removeCrewTitle');
  $: statusLabel =
    card.kind === 'treasury'
      ? treasuryProposalStatusLabel(card.proposal.status)
      : card.kind === 'mutiny'
        ? isMutinyExecutable(card.status)
          ? $t('governance.proposal.readyToExecute')
          : $t('governance.proposal.active')
        : card.status === 'executable'
          ? $t('governance.proposal.readyToExecute')
          : $t('governance.proposal.timelock');
  $: outcome =
    card.kind === 'treasury' ? treasuryProposalOutcomeLabel(card.proposal.status) : '';
  $: executeTitle = (() => {
    if (execUi.executeEnabled || !execUi.disabledReasonKey) {
      return $t('governance.common.execute');
    }
    if (
      execUi.disabledReasonKey === 'governance.proposal.executeLockedUntil' &&
      execUi.unlockAtSec
    ) {
      return $t(execUi.disabledReasonKey, {
        values: { when: new Date(execUi.unlockAtSec * 1000).toLocaleString() },
      });
    }
    return execUi.disabledReasonKey.startsWith('governance.')
      ? $t(execUi.disabledReasonKey)
      : execUi.disabledReasonKey;
  })();
</script>

<li
  class="proposal-card"
  class:proposal-card-active={isActive}
  class:proposal-card-past={isPast}
  class:proposal-card-executable={isExecutable}
>
  <div class="proposal-card-head">
    <span class="proposal-card-tool">{tool}</span>
    <span class="proposal-card-status" class:proposal-card-status-active={isActive && !isPast}>
      {statusLabel}
    </span>
  </div>
  <p class="proposal-card-title">{title}</p>
  {#if outcome && isPast}
    <p class="proposal-card-outcome">{outcome}</p>
  {/if}

  {#if card.kind === 'treasury'}
    <p class="proposal-card-meta muted">
      {$t('governance.proposal.meta', {
        values: {
          yeas: card.proposal.yeas,
          nays: card.proposal.nays,
          snapshot: card.proposal.snapshot,
          deadline: new Date(card.proposal.deadline * 1000).toLocaleString(),
        },
      })}
    </p>
    {#if card.proposal.captainApproved}
      <p class="proposal-card-meta muted">{$t('governance.proposal.captainApproved')}</p>
    {:else if card.proposal.captainDefeated}
      <p class="proposal-card-meta muted">{$t('governance.proposal.captainVetoed')}</p>
    {/if}
    <ProposalActionSummary
      to={card.proposal.to}
      valueWei={card.proposal.valueWei}
      dataHex={card.proposal.dataHex}
      operation={card.proposal.operation}
    />
  {:else if card.kind === 'mutiny'}
    <p class="proposal-card-meta muted">
      {$t('governance.proposal.mutinyMeta', {
        values: {
          candidate: card.status.proposedNewCaptain || '—',
          yeas: card.status.yeas,
          snapshot: card.status.snapshot,
        },
      })}
    </p>
    <p class="proposal-card-meta muted">
      {$t('governance.proposal.captainLine')}
      <code class="proposal-card-ref">{card.status.captain || '—'}</code>
    </p>
  {:else}
    <p class="proposal-card-meta muted">
      {card.kind === 'crew_add' ? $t('governance.proposal.candidate') : $t('governance.proposal.member')}
      <code class="proposal-card-ref">{card.address}</code>
    </p>
    <p class="proposal-card-meta muted">
      {$t('governance.proposal.executableAt', {
        values: { when: new Date(card.executableAt * 1000).toLocaleString() },
      })}
    </p>
  {/if}

  {#if showExecute && execUi.showExecute && onExecute}
    <div class="execute-wrap">
      <button
        type="button"
        class="execute-btn"
        disabled={executePending || !execUi.executeEnabled}
        title={executeTitle}
        on:click={() => onExecute()}
      >
        {$t('governance.common.execute')}
      </button>
      {#if !execUi.executeEnabled && execUi.disabledReasonKey}
        <p class="execute-reason muted">{executeTitle}</p>
      {/if}
    </div>
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
    border-color: var(--brand);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 25%, transparent);
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
  .execute-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 4px;
  }
  .execute-btn {
    font-size: 0.8125rem;
    padding: 6px 12px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    background: #16a34a;
    color: #fff;
    align-self: flex-start;
  }
  .execute-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .execute-reason {
    margin: 0;
    font-size: 0.6875rem;
    line-height: 1.3;
  }
</style>
