<script lang="ts">
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
  import { executableTreasuryProposals, isMutinyActive, isMutinyExecutable, isMutinyExpirable } from '../../../lib/governance/gov-proposal-lists';
  import { isCrewOffboardExecutable, isCrewOffboardExpirable } from '../../../lib/governance/crew-offboard';
  import { mutinyTxExplorerUrl, shortTxHash } from '../../../lib/governance/mutiny-process-tx';
  import { openExternalUrl } from '../../../lib/utils/open-external';
  import { scheduleDeadlineTimeout } from '../../../lib/utils/deadline-timeout';
  import ProposalActionSummary from './ProposalActionSummary.svelte';
  import GovCtaButton from './GovCtaButton.svelte';
  import type { CtaGate } from '../../../lib/governance/governance-privilege';

  interface Props {
    card: GovProcessCard;
    showExecute?: boolean;
    executePending?: boolean;
    /** Privilege gate i18n key (empty when allowed). Delay lock is derived from the card. */
    privilegeReasonKey?: string;
    onExecute?: () => void;
    onExpire?: () => void;
    network?: string;
    txHash?: string;
    showVotes?: boolean;
    votePending?: boolean;
    crewVoteGate?: CtaGate;
    captainVoteGate?: CtaGate;
    mutinyHasVoted?: boolean;
    offboardHasVoted?: boolean;
    onCrewVote?: (support: boolean) => void;
    onCaptainVote?: (support: boolean) => void;
    onMutinyVote?: () => void;
    onOffboardVote?: (support: boolean) => void;
  }

  let {
    card,
    showExecute = false,
    executePending = false,
    privilegeReasonKey = '',
    onExecute = undefined,
    onExpire = undefined,
    network = 'sepolia',
    txHash = '',
    showVotes = false,
    votePending = false,
    crewVoteGate = { enabled: false, reason: 'governance.status.loading' },
    captainVoteGate = { enabled: false, reason: 'governance.status.loading' },
    mutinyHasVoted = false,
    offboardHasVoted = false,
    onCrewVote = undefined,
    onCaptainVote = undefined,
    onMutinyVote = undefined,
    onOffboardVote = undefined,
  }: Props = $props();

  let nowSec = $state(0);
  const ALLOW_GATE: CtaGate = { enabled: true, reason: '' };
  let showCrewVotes = $derived(
    showVotes &&
      card.kind === 'treasury' &&
      card.proposal.status === 'active' &&
      !card.proposal.executed,
  );
  let showCaptainVotes = $derived(
    showVotes &&
      card.kind === 'treasury' &&
      card.proposal.status === 'active_passed_crew' &&
      !card.proposal.captainApproved &&
      !card.proposal.captainDefeated &&
      !card.proposal.executed,
  );
  let showMutinyVote = $derived(showVotes && card.kind === 'mutiny' && isMutinyActive(card.status));
  let showOffboardVotes = $derived(showVotes && card.kind === 'crew_offboard');
  let mutinyVoteGate = $derived.by((): CtaGate => {
    if (card.kind !== 'mutiny') return ALLOW_GATE;
    if (isMutinyExpirable(card.status, nowSec)) {
      return { enabled: false, reason: 'governance.gate.mutinyExpired' };
    }
    if (mutinyHasVoted) return { enabled: false, reason: 'governance.gate.alreadyVoted' };
    return crewVoteGate;
  });
  let offboardVoteGate = $derived.by((): CtaGate => {
    if (card.kind !== 'crew_offboard') return ALLOW_GATE;
    if (isCrewOffboardExpirable(card.status, nowSec)) {
      return { enabled: false, reason: 'governance.gate.offboardExpired' };
    }
    if (offboardHasVoted) return { enabled: false, reason: 'governance.gate.alreadyVotedOffboard' };
    return crewVoteGate;
  });

  let tool = $derived($t(govProcessToolLabel(card)));
  let isActive = $derived(card.kind === 'treasury' ? isTreasuryProposalActive(card.proposal.status) : true);
  let isPast = $derived(card.kind === 'treasury' ? isTreasuryProposalPast(card.proposal.status) : false);
  let cardUnlockAtSec = $derived(
    card.kind === 'crew_add' || card.kind === 'crew_remove'
      ? card.executableAt > 0
        ? card.executableAt
        : null
      : card.kind === 'mutiny' || card.kind === 'crew_offboard'
        ? card.status.deadline > 0
          ? card.status.deadline
          : null
        : null,
  );
  let execUi = $derived(govExecuteUiState({ card, privilegeReasonKey, nowSec }));
  let isExecutable = $derived(
    card.kind === 'treasury'
      ? executableTreasuryProposals([card.proposal]).length > 0
      : card.kind === 'mutiny'
        ? isMutinyExecutable(card.status, nowSec)
        : card.kind === 'crew_offboard'
          ? isCrewOffboardExecutable(card.status, card.quorumBps, nowSec)
          : card.status === 'executable',
  );
  let title = $derived(
    card.kind === 'treasury'
      ? $t('governance.proposal.title', { values: { id: card.proposal.proposalId } })
      : card.kind === 'mutiny'
        ? $t('governance.proposal.mutinyTitle', { values: { id: card.status.activeMutinyId } })
        : card.kind === 'crew_offboard'
          ? $t('governance.proposal.offboardTitle', { values: { id: card.status.offboardId } })
          : card.kind === 'crew_add'
            ? $t('governance.proposal.addCrewTitle')
            : $t('governance.proposal.removeCrewTitle'),
  );
  let statusLabel = $derived(
    card.kind === 'treasury'
      ? treasuryProposalStatusLabel(card.proposal.status)
      : card.kind === 'mutiny'
        ? isMutinyExpirable(card.status, nowSec)
          ? $t('governance.proposal.expired')
          : isMutinyExecutable(card.status, nowSec)
            ? $t('governance.proposal.readyToExecute')
            : $t('governance.proposal.active')
        : card.kind === 'crew_offboard'
          ? isCrewOffboardExpirable(card.status, nowSec)
            ? $t('governance.proposal.expired')
            : isCrewOffboardExecutable(card.status, card.quorumBps, nowSec)
              ? $t('governance.proposal.readyToExecute')
              : $t('governance.proposal.active')
        : card.status === 'executable'
          ? $t('governance.proposal.readyToExecute')
          : $t('governance.proposal.timelock'),
  );
  let outcome = $derived(card.kind === 'treasury' ? treasuryProposalOutcomeLabel(card.proposal.status) : '');
  let executeTitle = $derived.by(() => {
    if (execUi.executeEnabled || !execUi.disabledReasonKey) {
      return $t('governance.common.execute');
    }
    if (execUi.disabledReasonKey === 'governance.proposal.executeLockedUntil' && execUi.unlockAtSec) {
      return $t(execUi.disabledReasonKey, {
        values: { when: new Date(execUi.unlockAtSec * 1000).toLocaleString() },
      });
    }
    return execUi.disabledReasonKey.startsWith('governance.')
      ? $t(execUi.disabledReasonKey)
      : execUi.disabledReasonKey;
  });
  let expireTitle = $derived.by(() => {
    if (execUi.expireEnabled || !execUi.expireReasonKey) {
      return $t('governance.common.expire');
    }
    return execUi.expireReasonKey.startsWith('governance.')
      ? $t(execUi.expireReasonKey)
      : execUi.expireReasonKey;
  });
  let mutinyExplorerUrl = $derived(
    card.kind === 'mutiny' && txHash.trim() ? mutinyTxExplorerUrl(network, txHash) : null,
  );
  let mutinyTxShort = $derived(txHash.trim() ? shortTxHash(txHash.trim()) : '');

  $effect(() => {
    const unlockAt = cardUnlockAtSec;
    const alreadyOpen = unlockAt == null || unlockAt <= Math.floor(Date.now() / 1000);
    nowSec = alreadyOpen ? Math.floor(Date.now() / 1000) : 0;
    if (!alreadyOpen && unlockAt != null) {
      return scheduleDeadlineTimeout(unlockAt, () => {
        nowSec = Math.floor(Date.now() / 1000);
      });
    }
    return undefined;
  });
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
    {#if showCrewVotes && onCrewVote}
      <div class="vote-row">
        <GovCtaButton
          label={$t('governance.action.voteYea')}
          variant="primary"
          gate={crewVoteGate}
          acting={votePending}
          onClick={() => onCrewVote(true)}
        />
        <GovCtaButton
          label={$t('governance.action.voteNay')}
          gate={crewVoteGate}
          acting={votePending}
          onClick={() => onCrewVote(false)}
        />
      </div>
    {/if}
    {#if showCaptainVotes && onCaptainVote}
      <div class="vote-row">
        <GovCtaButton
          label={$t('governance.action.approve')}
          variant="primary"
          gate={captainVoteGate}
          acting={votePending}
          onClick={() => onCaptainVote(true)}
        />
        <GovCtaButton
          label={$t('governance.action.veto')}
          variant="danger"
          gate={captainVoteGate}
          acting={votePending}
          onClick={() => onCaptainVote(false)}
        />
      </div>
    {/if}
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
    {#if card.status.fromCaptain}
      <p class="proposal-card-meta muted">
        {$t('governance.mutiny.fromCaptain', { values: { address: card.status.fromCaptain } })}
      </p>
    {/if}
    {#if card.status.deadline > 0}
      <p class="proposal-card-meta muted">
        {$t('governance.mutiny.deadline', {
          values: { when: new Date(card.status.deadline * 1000).toLocaleString() },
        })}
      </p>
    {/if}
    <p class="proposal-card-meta muted">
      {$t('governance.proposal.captainLine')}
      <code class="proposal-card-ref">{card.status.captain || '—'}</code>
    </p>
    {#if mutinyTxShort}
      <p class="proposal-card-meta muted">
        {$t('governance.proposal.txHash', { values: { hash: mutinyTxShort } })}
        {#if mutinyExplorerUrl}
          <button
            type="button"
            class="proposal-card-tx-link"
            onclick={() => {
              if (mutinyExplorerUrl) openExternalUrl(mutinyExplorerUrl);
            }}
          >
            {$t('governance.action.viewOnExplorer')}
          </button>
        {/if}
      </p>
    {/if}
    {#if showMutinyVote && onMutinyVote}
      <div class="vote-row">
        <GovCtaButton
          label={mutinyHasVoted ? $t('governance.action.alreadyVoted') : $t('governance.action.castMutinyVote')}
          variant="primary"
          gate={mutinyVoteGate}
          acting={votePending}
          onClick={onMutinyVote}
        />
      </div>
    {/if}
  {:else if card.kind === 'crew_offboard'}
    <p class="proposal-card-meta muted">
      {$t('governance.proposal.offboardMeta', {
        values: {
          address: card.status.target || '—',
          yeas: card.status.yeas,
          nays: card.status.nays,
          snapshot: card.status.snapshot,
          deadline: card.status.deadline > 0 ? new Date(card.status.deadline * 1000).toLocaleString() : '—',
        },
      })}
    </p>
    {#if showOffboardVotes && onOffboardVote}
      <div class="vote-row">
        <GovCtaButton
          label={offboardHasVoted ? $t('governance.action.alreadyVotedOffboard') : $t('governance.action.voteYea')}
          variant="primary"
          gate={offboardVoteGate}
          acting={votePending}
          onClick={() => onOffboardVote(true)}
        />
        <GovCtaButton
          label={$t('governance.action.voteNay')}
          gate={offboardVoteGate}
          acting={votePending}
          onClick={() => onOffboardVote(false)}
        />
      </div>
    {/if}
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
        onclick={() => onExecute()}
      >
        {$t('governance.common.execute')}
      </button>
      {#if !execUi.executeEnabled && execUi.disabledReasonKey}
        <p class="execute-reason muted">{executeTitle}</p>
      {/if}
    </div>
  {/if}
  {#if showExecute && execUi.showExpire && onExpire}
    <div class="execute-wrap">
      <button
        type="button"
        class="expire-btn"
        disabled={executePending || !execUi.expireEnabled}
        title={expireTitle}
        onclick={() => onExpire()}
      >
        {$t('governance.common.expire')}
      </button>
      {#if !execUi.expireEnabled && execUi.expireReasonKey}
        <p class="execute-reason muted">{expireTitle}</p>
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
  .proposal-card-meta {
    font-size: 0.8125rem;
    line-height: 1.45;
    margin: 0 0 8px 0;
  }
  .proposal-card-ref {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    word-break: break-all;
  }
  .proposal-card-tx-link {
    margin-left: 8px;
    padding: 0;
    border: none;
    background: none;
    color: var(--brand);
    cursor: pointer;
    font-size: inherit;
    text-decoration: underline;
  }
  .muted {
    color: var(--text-muted);
  }
  .vote-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 4px 0 8px;
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
  .expire-btn {
    font-size: 0.8125rem;
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    cursor: pointer;
    background: var(--bg-elevated);
    color: var(--text-secondary);
    align-self: flex-start;
  }
  .expire-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .execute-reason {
    margin: 0;
    font-size: 0.6875rem;
    line-height: 1.3;
  }
</style>
