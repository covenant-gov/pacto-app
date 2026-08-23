<script lang="ts">
  import RefreshIconButton from '../../ui/RefreshIconButton.svelte';
  import RpcReadErrorCard from '../dashboard/RpcReadErrorCard.svelte';
  import { rpcReadErrorKind } from '../../../lib/squad/rpc-read-error';
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
  import {
    fundedByFromWriteResult,
    govWriteSubmittedToast,
  } from '../../../lib/governance/gov-write-funding';
  import { showGovWriteErrorToast } from '../../../lib/governance/gov-write-errors';
  import {
    mutinyProcessTxByParentId,
    mutinyTxHashForCard,
  } from '../../../lib/governance/mutiny-process-tx';
  import { showToast } from '../../../stores/toast';
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
    fundingHint?: string;
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
    fundingHint = '',
    capabilitiesPending = false,
  }: Props = $props();

  const tFn = get(t);
  const PENDING_GATE: CtaGate = { enabled: false, reason: 'governance.status.loading' };

  let acting = $state(false);

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

  async function runTreasuryExecute(proposalId: string) {
    if (acting || !execGate.enabled) return;
    acting = true;
    try {
      const result = await treasuryAuthorityExecute({
        network,
        parentId,
        treasuryAuthority,
        proposalId,
      });
      showToast(govWriteSubmittedToast(tFn('governance.action.execute'), fundedByFromWriteResult(result)));
      onRefreshProposals();
    } catch (e) {
      showGovWriteErrorToast(e, tFn('governance.action.execute'));
    } finally {
      acting = false;
    }
  }

  async function runCrewExecute(card: Extract<GovProcessCard, { kind: 'crew_add' | 'crew_remove' }>) {
    const ui = govExecuteUiState({
      card,
      privilegeReasonKey: qmExecGate.enabled ? '' : qmExecGate.reason,
    });
    if (acting || !ui.executeEnabled || !quartermaster.trim()) return;
    acting = true;
    try {
      if (card.kind === 'crew_add') {
        const result = await quartermasterExecuteAddCrew({
          network,
          parentId,
          quartermaster,
          candidate: card.address,
        });
        showToast(govWriteSubmittedToast(tFn('governance.action.executeAdd'), fundedByFromWriteResult(result)));
      } else {
        const result = await quartermasterExecuteRemoveCrew({
          network,
          parentId,
          quartermaster,
          crew: card.address,
        });
        showToast(govWriteSubmittedToast(tFn('governance.action.executeRemove'), fundedByFromWriteResult(result)));
      }
      onRefreshProposals();
    } catch (e) {
      showGovWriteErrorToast(e, tFn('governance.action.execute'));
    } finally {
      acting = false;
    }
  }

  async function runMutinyExecute() {
    if (acting) return;
    acting = true;
    try {
      await onExecuteMutiny();
    } finally {
      acting = false;
    }
  }

  async function runMutinyExpire() {
    if (acting) return;
    acting = true;
    try {
      await onExpireMutiny();
    } finally {
      acting = false;
    }
  }

  async function runOffboardExecute(offboardId: string) {
    if (acting || !execGate.enabled || !quartermaster.trim()) return;
    acting = true;
    try {
      const result = await quartermasterExecuteOffboard({
        network,
        parentId,
        quartermaster,
        offboardId,
      });
      showToast(
        govWriteSubmittedToast(tFn('governance.action.executeOffboard'), fundedByFromWriteResult(result)),
      );
      onRefreshProposals();
    } catch (e) {
      showGovWriteErrorToast(e, tFn('governance.action.executeOffboard'));
    } finally {
      acting = false;
    }
  }

  async function runOffboardExpire(offboardId: string) {
    if (acting || !execGate.enabled || !quartermaster.trim()) return;
    acting = true;
    try {
      const result = await quartermasterExpireOffboard({
        network,
        parentId,
        quartermaster,
        offboardId,
      });
      showToast(
        govWriteSubmittedToast(tFn('governance.action.expireOffboard'), fundedByFromWriteResult(result)),
      );
      onRefreshProposals();
    } catch (e) {
      showGovWriteErrorToast(e, tFn('governance.action.expireOffboard'));
    } finally {
      acting = false;
    }
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

  async function runCrewVote(proposalId: string, support: boolean) {
    if (acting || !crewVoteGate.enabled || !requireBackupVerified()) return;
    acting = true;
    const label = support ? tFn('governance.action.crewYea') : tFn('governance.action.crewNay');
    try {
      const result = await treasuryAuthorityCrewVote({
        network,
        parentId,
        treasuryAuthority,
        proposalId,
        support,
      });
      showToast(govWriteSubmittedToast(label, fundedByFromWriteResult(result)));
      onRefreshProposals();
    } catch (e) {
      showGovWriteErrorToast(e, label);
    } finally {
      acting = false;
    }
  }

  async function runCaptainVote(proposalId: string, support: boolean) {
    if (acting || !captainVoteGate.enabled) return;
    acting = true;
    const label = support ? tFn('governance.action.captainApprove') : tFn('governance.action.captainVeto');
    try {
      const result = await treasuryAuthorityCaptainVote({
        network,
        parentId,
        treasuryAuthority,
        proposalId,
        support,
      });
      showToast(govWriteSubmittedToast(label, fundedByFromWriteResult(result)));
      onRefreshProposals();
    } catch (e) {
      showGovWriteErrorToast(e, label);
    } finally {
      acting = false;
    }
  }

  async function runMutinyVote() {
    if (acting || !mutinyModule.trim() || !mutinyStatus) return;
    acting = true;
    const label = tFn('governance.action.mutinyVote');
    try {
      const result = await mutinyCastVote({
        network,
        parentId,
        mutinyModule,
        mutinyId: mutinyStatus.activeMutinyId,
      });
      showToast(govWriteSubmittedToast(label, fundedByFromWriteResult(result)));
      onRefreshProposals();
    } catch (e) {
      showGovWriteErrorToast(e, label);
    } finally {
      acting = false;
    }
  }

  async function runOffboardVote(support: boolean) {
    if (acting || !quartermaster.trim() || !qmStatus?.offboard || !requireBackupVerified()) return;
    acting = true;
    const label = support ? tFn('governance.action.voteYea') : tFn('governance.action.voteNay');
    try {
      const result = await quartermasterCrewOffboardVote({
        network,
        parentId,
        quartermaster,
        offboardId: qmStatus.offboard.offboardId,
        support,
      });
      showToast(govWriteSubmittedToast(label, fundedByFromWriteResult(result)));
      onRefreshProposals();
    } catch (e) {
      showGovWriteErrorToast(e, label);
    } finally {
      acting = false;
    }
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
  {#if fundingHint}
    <p class="muted funding-hint">{fundingHint}</p>
  {/if}

  {#if boardLoading}
    <p class="muted">{$t('governance.status.loadingProposals')}</p>
  {:else if processCards.length === 0}
    {#if proposalsRpcKind}
      <RpcReadErrorCard kind={proposalsRpcKind} />
    {:else if qmPendingRpcKind}
      <RpcReadErrorCard kind={qmPendingRpcKind} />
    {:else}
      <p class="muted">
        {proposalsError || qmPendingError || $t('governance.empty.noTreasuryProposals')}
      </p>
    {/if}
  {:else}
    {#if proposalsRpcKind}
      <RpcReadErrorCard kind={proposalsRpcKind} />
    {:else if proposalsError}
      <p class="muted">{proposalsError}</p>
    {/if}
    {#if qmPendingRpcKind}
      <RpcReadErrorCard kind={qmPendingRpcKind} />
    {:else if qmPendingError}
      <p class="muted">{qmPendingError}</p>
    {/if}
    <ul class="proposal-list" role="list">
      {#each processCards as card (govProcessCardKey(card))}
        <GovProcessCardView
          {card}
          {network}
          txHash={card.kind === 'mutiny' ? mutinyTxHash : ''}
          showExecute
          executePending={acting}
          privilegeReasonKey={privilegeReasonKeyFor(card)}
          onExecute={() => executeForCard(card)}
          onExpire={() => expireForCard(card)}
          showVotes
          votePending={acting}
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
  .funding-hint {
    margin: 0 0 4px;
  }
</style>
