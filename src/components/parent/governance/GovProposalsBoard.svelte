<script lang="ts">
  import RefreshIconButton from '../../ui/RefreshIconButton.svelte';
  import RpcReadErrorCard from '../dashboard/RpcReadErrorCard.svelte';
  import { rpcReadErrorKind, uniqueRpcReadErrorKinds } from '../../../lib/squad/rpc-read-error';
  import GovProcessCardView from './GovProcessCard.svelte';
  import {
    quartermasterExecuteAddCrew,
    quartermasterExecuteOffboard,
    quartermasterExecuteRemoveCrew,
    quartermasterExpireOffboard,
    mutinyCastVote,
    quartermasterCrewOffboardVote,
    treasuryAuthorityCaptainVote,
    treasuryAuthorityCrewVote,
    treasuryAuthorityExecute,
    type MutinyStatusDto,
    type QuartermasterPendingActionDto,
    type QuartermasterStatusDto,
    type TreasuryProposalDto,
  } from '../../../lib/governance/api';
  import {
    gatePermissionlessSigner,
    gateQuartermasterExecute,
    gateRequiresCaptain,
    gateRequiresCrew,
    type CtaGate,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import {
    buildGovProcessCards,
    countOpenGovProcesses,
    govProcessCardKey,
    type GovProcessCard,
  } from '../../../lib/governance/gov-process';
  import { govExecuteUiState } from '../../../lib/governance/gov-execute-ui';
  import { parseQuorumBps } from '../../../lib/governance/crew-offboard';
  import { runGovWriteInBackground } from '../../../lib/governance/gov-write-background';
  import { hasPendingJob, pendingOnChainJobs } from '../../../stores/pending-on-chain';
  import {
    mutinyProcessTxByParentId,
    mutinyTxHashForCard,
  } from '../../../lib/governance/mutiny-process-tx';
  import { requireBackupVerified } from '../../../stores/backup-verification';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  interface Props {
    network: string;
    parentId: string;
    treasuryAuthority: string;
    quartermaster?: string;
    mutinyModule?: string;
    privilege: GovernancePrivilege;
    proposals?: TreasuryProposalDto[];
    proposalsLoading?: boolean;
    proposalsError?: string;
    mutinyStatus?: MutinyStatusDto | null;
    mutinyLoading?: boolean;
    qmStatus?: QuartermasterStatusDto | null;
    qmPending?: QuartermasterPendingActionDto[];
    qmPendingLoading?: boolean;
    qmPendingError?: string;
    mutinyMode?: boolean;
    rosterFreezeReason?: string;
    mutinyHasVoted?: boolean;
    offboardHasVoted?: boolean;
    onRefreshProposals?: () => void;
    onExecuteMutiny?: () => void | Promise<void>;
    onExpireMutiny?: () => void | Promise<void>;
    /** True while capability preflight is still loading; forces every gate closed. */
    capabilitiesPending?: boolean;
  }

  let {
    network,
    parentId,
    treasuryAuthority,
    quartermaster = '',
    mutinyModule = '',
    privilege,
    proposals = [],
    proposalsLoading = false,
    proposalsError = '',
    mutinyStatus = null,
    mutinyLoading = false,
    qmStatus = null,
    qmPending = [],
    qmPendingLoading = false,
    qmPendingError = '',
    mutinyMode = false,
    rosterFreezeReason = 'governance.gate.quartermasterLocked',
    mutinyHasVoted = false,
    offboardHasVoted = false,
    onRefreshProposals = () => {},
    onExecuteMutiny = () => {},
    onExpireMutiny = () => {},
    capabilitiesPending = false,
  }: Props = $props();

  const tFn = get(t);
  const PENDING_GATE: CtaGate = { enabled: false, reason: 'governance.status.loading' };

  let execGate = $derived(capabilitiesPending ? PENDING_GATE : gatePermissionlessSigner(privilege));
  let crewVoteGate = $derived(capabilitiesPending ? PENDING_GATE : gateRequiresCrew(privilege));
  let captainVoteGate = $derived(capabilitiesPending ? PENDING_GATE : gateRequiresCaptain(privilege));
  let qmExecGate = $derived(
    capabilitiesPending ? PENDING_GATE : gateQuartermasterExecute(privilege, mutinyMode, rosterFreezeReason),
  );
  let processCards = $derived(
    buildGovProcessCards({
      treasuryProposals: proposals,
      mutinyStatus,
      qmPending,
      crewOffboard: qmStatus?.offboard ?? null,
      crewOffboardQuorumBps: parseQuorumBps(qmStatus?.crewOffboardQuorumBps),
    }),
  );
  let openCount = $derived(countOpenGovProcesses(processCards));
  let mutinyTxHash = $derived(mutinyTxHashForCard($mutinyProcessTxByParentId, parentId));
  let boardLoading = $derived(
    (proposalsLoading && proposals.length === 0) ||
      (mutinyLoading && !mutinyStatus) ||
      (qmPendingLoading && qmPending.length === 0),
  );
  let refreshSpinning = $derived(proposalsLoading || mutinyLoading || qmPendingLoading);
  let proposalsRpcKind = $derived(rpcReadErrorKind(proposalsError));
  let qmPendingRpcKind = $derived(rpcReadErrorKind(qmPendingError));
  let boardRpcKinds = $derived(uniqueRpcReadErrorKinds(proposalsError, qmPendingError));

  function runBoardWrite(label: string, actionKey: string, job: () => Promise<unknown>) {
    runGovWriteInBackground({
      label,
      parentId,
      actionKey,
      job,
      onSettled: () => onRefreshProposals(),
    });
  }

  function cardActionKey(card: GovProcessCard, verb: string): string {
    return `${card.kind}:${verb}:${govProcessCardKey(card)}`;
  }

  function runTreasuryExecute(proposalId: string) {
    if (!execGate.enabled) return;
    runBoardWrite(tFn('governance.action.execute'), `treasury-exec:${proposalId}`, () =>
      treasuryAuthorityExecute({
        network,
        parentId,
        treasuryAuthority,
        proposalId,
      }),
    );
  }

  function runCrewExecute(card: Extract<GovProcessCard, { kind: 'crew_add' | 'crew_remove' }>) {
    const ui = govExecuteUiState({
      card,
      privilegeReasonKey: qmExecGate.enabled ? '' : qmExecGate.reason,
    });
    if (!ui.executeEnabled || !quartermaster.trim()) return;
    if (card.kind === 'crew_add') {
      runBoardWrite(tFn('governance.action.executeAdd'), cardActionKey(card, 'exec'), () =>
        quartermasterExecuteAddCrew({
          network,
          parentId,
          quartermaster,
          candidate: card.address,
        }),
      );
      return;
    }
    runBoardWrite(tFn('governance.action.executeRemove'), cardActionKey(card, 'exec'), () =>
      quartermasterExecuteRemoveCrew({
        network,
        parentId,
        quartermaster,
        crew: card.address,
      }),
    );
  }

  function runMutinyExecute() {
    void onExecuteMutiny();
  }

  function runMutinyExpire() {
    void onExpireMutiny();
  }

  function runOffboardExecute(offboardId: string) {
    if (!execGate.enabled || !quartermaster.trim()) return;
    runBoardWrite(tFn('governance.action.executeOffboard'), `offboard-exec:${offboardId}`, () =>
      quartermasterExecuteOffboard({
        network,
        parentId,
        quartermaster,
        offboardId,
      }),
    );
  }

  function runOffboardExpire(offboardId: string) {
    if (!execGate.enabled || !quartermaster.trim()) return;
    runBoardWrite(tFn('governance.action.expireOffboard'), `offboard-expire:${offboardId}`, () =>
      quartermasterExpireOffboard({
        network,
        parentId,
        quartermaster,
        offboardId,
      }),
    );
  }

  function executeForCard(card: GovProcessCard) {
    if (card.kind === 'treasury') {
      void runTreasuryExecute(card.proposal.proposalId);
    } else if (card.kind === 'mutiny') {
      void runMutinyExecute();
    } else if (card.kind === 'crew_offboard') {
      void runOffboardExecute(card.status.offboardId);
    } else {
      void runCrewExecute(card);
    }
  }

  function expireForCard(card: GovProcessCard) {
    if (card.kind === 'mutiny') {
      void runMutinyExpire();
    } else if (card.kind === 'crew_offboard') {
      void runOffboardExpire(card.status.offboardId);
    }
  }

  function runCrewVote(proposalId: string, support: boolean) {
    if (!crewVoteGate.enabled || !requireBackupVerified()) return;
    const label = support ? tFn('governance.action.crewYea') : tFn('governance.action.crewNay');
    runBoardWrite(label, `treasury-crew-vote:${proposalId}`, () =>
      treasuryAuthorityCrewVote({
        network,
        parentId,
        treasuryAuthority,
        proposalId,
        support,
      }),
    );
  }

  function runCaptainVote(proposalId: string, support: boolean) {
    if (!captainVoteGate.enabled) return;
    const label = support ? tFn('governance.action.captainApprove') : tFn('governance.action.captainVeto');
    runBoardWrite(label, `treasury-captain-vote:${proposalId}`, () =>
      treasuryAuthorityCaptainVote({
        network,
        parentId,
        treasuryAuthority,
        proposalId,
        support,
      }),
    );
  }

  function runMutinyVote() {
    const status = mutinyStatus;
    if (!mutinyModule.trim() || !status) return;
    const label = tFn('governance.action.mutinyVote');
    runBoardWrite(label, `mutiny-vote:${status.activeMutinyId}`, () =>
      mutinyCastVote({
        network,
        parentId,
        mutinyModule,
        mutinyId: status.activeMutinyId,
      }),
    );
  }

  function runOffboardVote(support: boolean) {
    const offboard = qmStatus?.offboard;
    if (!quartermaster.trim() || !offboard || !requireBackupVerified()) return;
    const label = support ? tFn('governance.action.voteYea') : tFn('governance.action.voteNay');
    runBoardWrite(label, `offboard-vote:${offboard.offboardId}`, () =>
      quartermasterCrewOffboardVote({
        network,
        parentId,
        quartermaster,
        offboardId: offboard.offboardId,
        support,
      }),
    );
  }

  function cardPending(card: GovProcessCard): boolean {
    void $pendingOnChainJobs;
    const key = govProcessCardKey(card);
    return (
      hasPendingJob(parentId, `${card.kind}:exec:${key}`) ||
      hasPendingJob(parentId, `treasury-exec:${card.kind === 'treasury' ? card.proposal.proposalId : ''}`) ||
      hasPendingJob(parentId, `treasury-crew-vote:${card.kind === 'treasury' ? card.proposal.proposalId : ''}`) ||
      hasPendingJob(parentId, `treasury-captain-vote:${card.kind === 'treasury' ? card.proposal.proposalId : ''}`) ||
      hasPendingJob(parentId, `mutiny-vote:${mutinyStatus?.activeMutinyId ?? ''}`) ||
      (card.kind === 'crew_offboard' &&
        (hasPendingJob(parentId, `offboard-exec:${card.status.offboardId}`) ||
          hasPendingJob(parentId, `offboard-expire:${card.status.offboardId}`) ||
          hasPendingJob(parentId, `offboard-vote:${card.status.offboardId}`)))
    );
  }

  function privilegeReasonKeyFor(card: GovProcessCard): string {
    if (card.kind === 'crew_add' || card.kind === 'crew_remove') {
      return qmExecGate.enabled ? '' : qmExecGate.reason;
    }
    return execGate.enabled ? '' : execGate.reason;
  }
</script>

<div class="proposals-board">
  <div class="board-head">
    <h4 class="board-title">{$t('governance.proposal.boardTitle')}{#if openCount} {$t('governance.proposal.openCount', { values: { count: openCount } })}{/if}</h4>
    <RefreshIconButton
      spinning={refreshSpinning}
      ariaLabel={refreshSpinning ? $t('governance.aria.refreshingProposals') : $t('governance.aria.refreshProposals')}
      onclick={onRefreshProposals}
    />
  </div>

  {#if boardLoading}
    <p class="muted">{$t('governance.status.loadingProposals')}</p>
  {:else if processCards.length === 0}
    {#each boardRpcKinds as kind (kind)}
      <RpcReadErrorCard {kind} />
    {/each}
    {#if proposalsError && !proposalsRpcKind}
      <p class="muted">{proposalsError}</p>
    {:else if qmPendingError && !qmPendingRpcKind}
      <p class="muted">{qmPendingError}</p>
    {:else if boardRpcKinds.length === 0}
      <p class="muted">{$t('governance.empty.noTreasuryProposals')}</p>
    {/if}
  {:else}
    {#each boardRpcKinds as kind (kind)}
      <RpcReadErrorCard {kind} />
    {/each}
    {#if proposalsError && !proposalsRpcKind}
      <p class="muted">{proposalsError}</p>
    {/if}
    {#if qmPendingError && !qmPendingRpcKind}
      <p class="muted">{qmPendingError}</p>
    {/if}
    <ul class="proposal-list" role="list">
      {#each processCards as card (govProcessCardKey(card))}
        <GovProcessCardView
          {card}
          {network}
          txHash={card.kind === 'mutiny' ? mutinyTxHash : ''}
          showExecute
          executePending={cardPending(card)}
          privilegeReasonKey={privilegeReasonKeyFor(card)}
          onExecute={() => executeForCard(card)}
          onExpire={() => expireForCard(card)}
          showVotes
          votePending={cardPending(card) || (card.kind === 'mutiny' && mutinyLoading)}
          {crewVoteGate}
          {captainVoteGate}
          {mutinyHasVoted}
          {offboardHasVoted}
          onCrewVote={
            card.kind === 'treasury' ? (support) => void runCrewVote(card.proposal.proposalId, support) : undefined
          }
          onCaptainVote={
            card.kind === 'treasury' ? (support) => void runCaptainVote(card.proposal.proposalId, support) : undefined
          }
          onMutinyVote={card.kind === 'mutiny' ? () => void runMutinyVote() : undefined}
          onOffboardVote={card.kind === 'crew_offboard' ? (support) => void runOffboardVote(support) : undefined}
        />
      {/each}
    </ul>
  {/if}
</div>

<style>
  .proposals-board {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .board-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .board-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    flex: 1;
  }
  .proposal-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .muted {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
</style>
