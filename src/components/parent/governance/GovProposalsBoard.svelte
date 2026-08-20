<script lang="ts">
  import RefreshIconButton from '../../ui/RefreshIconButton.svelte';
  import RpcReadErrorCard from '../dashboard/RpcReadErrorCard.svelte';
  import { rpcReadErrorKind } from '../../../lib/squad/rpc-read-error';
  import GovProcessCardView from './GovProcessCard.svelte';
  import {
    quartermasterExecuteAddCrew,
    quartermasterExecuteRemoveCrew,
    treasuryAuthorityExecute,
    type MutinyStatusDto,
    type QuartermasterPendingActionDto,
    type TreasuryProposalDto,
  } from '../../../lib/governance/api';
  import {
    gatePermissionlessSigner,
    gateQuartermasterExecute,
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
  import {
    fundedByFromWriteResult,
    govWriteSubmittedToast,
  } from '../../../lib/governance/gov-write-funding';
  import { govWriteErrorMessage } from '../../../lib/governance/gov-write-errors';
  import { showToast } from '../../../stores/toast';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  interface Props {
    network: string;
    parentId: string;
    treasuryAuthority: string;
    quartermaster?: string;
    privilege: GovernancePrivilege;
    proposals?: TreasuryProposalDto[];
    proposalsLoading?: boolean;
    proposalsError?: string;
    mutinyStatus?: MutinyStatusDto | null;
    mutinyLoading?: boolean;
    qmPending?: QuartermasterPendingActionDto[];
    qmPendingLoading?: boolean;
    qmPendingError?: string;
    mutinyMode?: boolean;
    onRefreshProposals?: () => void;
    onExecuteMutiny?: () => void | Promise<void>;
    fundingHint?: string;
    /** True while capability preflight is still loading; forces every gate closed. */
    capabilitiesPending?: boolean;
  }

  let {
    network,
    parentId,
    treasuryAuthority,
    quartermaster = '',
    privilege,
    proposals = [],
    proposalsLoading = false,
    proposalsError = '',
    mutinyStatus = null,
    mutinyLoading = false,
    qmPending = [],
    qmPendingLoading = false,
    qmPendingError = '',
    mutinyMode = false,
    onRefreshProposals = () => {},
    onExecuteMutiny = () => {},
    fundingHint = '',
    capabilitiesPending = false,
  }: Props = $props();

  const tFn = get(t);
  const PENDING_GATE: CtaGate = { enabled: false, reason: 'governance.status.loading' };

  let acting = $state(false);

  let execGate = $derived(capabilitiesPending ? PENDING_GATE : gatePermissionlessSigner(privilege));
  let qmExecGate = $derived(
    capabilitiesPending ? PENDING_GATE : gateQuartermasterExecute(privilege, mutinyMode),
  );
  let processCards = $derived(
    buildGovProcessCards({
      treasuryProposals: proposals,
      mutinyStatus,
      qmPending,
    }),
  );
  let openCount = $derived(countOpenGovProcesses(processCards));
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

  function executeForCard(card: GovProcessCard) {
    if (card.kind === 'treasury') {
      void runTreasuryExecute(card.proposal.proposalId);
    } else if (card.kind === 'mutiny') {
      void runMutinyExecute();
    } else {
      void runCrewExecute(card);
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
