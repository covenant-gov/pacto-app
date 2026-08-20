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
    treasuryAuthorityExecute,
    type MutinyStatusDto,
    type QuartermasterPendingActionDto,
    type QuartermasterStatusDto,
    type TreasuryProposalDto,
  } from '../../../lib/governance/api';
  import {
    gatePermissionlessSigner,
    gateQuartermasterExecute,
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
  import { govWriteErrorMessage } from '../../../lib/governance/gov-write-errors';
  import { showToast } from '../../../stores/toast';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  export let network: string;
  export let parentId: string;
  export let treasuryAuthority: string;
  export let quartermaster = '';
  export let privilege: GovernancePrivilege;
  export let proposals: TreasuryProposalDto[] = [];
  export let proposalsLoading = false;
  export let proposalsError = '';
  export let mutinyStatus: MutinyStatusDto | null = null;
  export let mutinyLoading = false;
  export let qmStatus: QuartermasterStatusDto | null = null;
  export let qmPending: QuartermasterPendingActionDto[] = [];
  export let qmPendingLoading = false;
  export let qmPendingError = '';
  export let mutinyMode = false;
  export let rosterFreezeReason = 'governance.gate.quartermasterLocked';
  export let onRefreshProposals: () => void = () => {};
  export let onExecuteMutiny: () => void | Promise<void> = () => {};
  export let onExpireMutiny: () => void | Promise<void> = () => {};
  export let fundingHint = '';

  const tFn = get(t);

  let acting = false;

  $: execGate = gatePermissionlessSigner(privilege);
  $: qmExecGate = gateQuartermasterExecute(privilege, mutinyMode, rosterFreezeReason);
  $: processCards = buildGovProcessCards({
    treasuryProposals: proposals,
    mutinyStatus,
    qmPending,
    crewOffboard: qmStatus?.offboard ?? null,
    crewOffboardQuorumBps: parseQuorumBps(qmStatus?.crewOffboardQuorumBps),
  });
  $: openCount = countOpenGovProcesses(processCards);
  $: boardLoading =
    (proposalsLoading && proposals.length === 0) ||
    (mutinyLoading && !mutinyStatus) ||
    (qmPendingLoading && qmPending.length === 0);
  $: refreshSpinning = proposalsLoading || mutinyLoading || qmPendingLoading;
  $: proposalsRpcKind = rpcReadErrorKind(proposalsError);
  $: qmPendingRpcKind = rpcReadErrorKind(qmPendingError);

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
      showToast(govWriteErrorMessage(e, tFn('governance.action.execute')));
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
      showToast(govWriteErrorMessage(e, tFn('governance.action.execute')));
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
      showToast(govWriteErrorMessage(e, tFn('governance.action.executeOffboard')));
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
      showToast(govWriteErrorMessage(e, tFn('governance.action.expireOffboard')));
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
          showExecute
          executePending={acting}
          privilegeReasonKey={privilegeReasonKeyFor(card)}
          onExecute={() => executeForCard(card)}
          onExpire={() => expireForCard(card)}
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
