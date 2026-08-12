import type {
  MutinyStatusDto,
  QuartermasterPendingActionDto,
  TreasuryProposalDto,
} from './api';
import { govExecuteUiState } from './gov-execute-ui';
import { buildGovProcessCards } from './gov-process';
import {
  captainVotableProposals,
  crewVotableProposals,
  isMutinyActive,
  isMutinyExecutable,
} from './gov-proposal-lists';
import {
  gatePermissionlessSigner,
  gateQuartermasterExecute,
  gateRequiresCaptain,
  gateRequiresCrew,
  type GovernancePrivilege,
} from './governance-privilege';

export type GovActionPromptKind = 'vote_needed' | 'delay_unlock' | 'execute_ready';

export type GovActionPrompt = {
  kind: GovActionPromptKind;
  sourceEventId: string;
  parentId: string;
  /** i18n title key */
  titleKey: string;
  /** i18n body key */
  bodyKey: string;
  bodyValues?: Record<string, string | number>;
  unlockAtSec?: number;
  /** Lower sorts first: execute → vote → delay */
  urgency: number;
};

const DEFAULT_MAX = 5;

function urgencyFor(kind: GovActionPromptKind): number {
  if (kind === 'execute_ready') return 0;
  if (kind === 'vote_needed') return 1;
  return 2;
}

export function deriveGovActionPrompts(params: {
  parentId: string;
  proposals: TreasuryProposalDto[];
  mutinyStatus: MutinyStatusDto | null | undefined;
  qmPending: QuartermasterPendingActionDto[];
  privilege: GovernancePrivilege;
  mutinyMode: boolean;
  treasuryVoteMap: Record<string, boolean>;
  mutinyHasVoted: boolean;
  nowSec?: number;
  maxPrompts?: number;
}): GovActionPrompt[] {
  const parentId = params.parentId.trim();
  if (!parentId) return [];

  const now = params.nowSec ?? Math.floor(Date.now() / 1000);
  const max = params.maxPrompts ?? DEFAULT_MAX;
  const out: GovActionPrompt[] = [];

  const crewGate = gateRequiresCrew(params.privilege);
  const captainGate = gateRequiresCaptain(params.privilege);
  const execGate = gatePermissionlessSigner(params.privilege);
  const qmExecGate = gateQuartermasterExecute(params.privilege, params.mutinyMode);
  const execPrivilegeKey = execGate.enabled ? '' : execGate.reason;
  const qmPrivilegeKey = qmExecGate.enabled ? '' : qmExecGate.reason;

  const cards = buildGovProcessCards({
    treasuryProposals: params.proposals,
    mutinyStatus: params.mutinyStatus,
    qmPending: params.qmPending,
    nowSec: now,
  });

  // Execute-ready
  for (const card of cards) {
    const privilegeReasonKey =
      card.kind === 'crew_add' || card.kind === 'crew_remove' ? qmPrivilegeKey : execPrivilegeKey;
    const ui = govExecuteUiState({ card, privilegeReasonKey, nowSec: now });
    if (!ui.showExecute || !ui.executeEnabled) continue;

    if (card.kind === 'treasury') {
      const id = card.proposal.proposalId;
      out.push({
        kind: 'execute_ready',
        sourceEventId: `gov-execute:treasury:${parentId}:${id}`,
        parentId,
        titleKey: 'governance.alerts.prompt.executeReadyTitle',
        bodyKey: 'governance.alerts.prompt.executeReadyTreasury',
        bodyValues: { id },
        urgency: urgencyFor('execute_ready'),
      });
    } else if (card.kind === 'mutiny') {
      const id = card.status.activeMutinyId;
      out.push({
        kind: 'execute_ready',
        sourceEventId: `gov-execute:mutiny:${parentId}:${id}`,
        parentId,
        titleKey: 'governance.alerts.prompt.executeReadyTitle',
        bodyKey: 'governance.alerts.prompt.executeReadyMutiny',
        bodyValues: { id },
        urgency: urgencyFor('execute_ready'),
      });
    } else {
      out.push({
        kind: 'execute_ready',
        sourceEventId: `gov-execute:${card.kind}:${parentId}:${card.address.toLowerCase()}`,
        parentId,
        titleKey: 'governance.alerts.prompt.executeReadyTitle',
        bodyKey:
          card.kind === 'crew_add'
            ? 'governance.alerts.prompt.executeReadyCrewAdd'
            : 'governance.alerts.prompt.executeReadyCrewRemove',
        urgency: urgencyFor('execute_ready'),
      });
    }
  }

  // Vote-needed (treasury crew)
  if (crewGate.enabled) {
    for (const p of crewVotableProposals(params.proposals)) {
      if (params.treasuryVoteMap[p.proposalId]) continue;
      out.push({
        kind: 'vote_needed',
        sourceEventId: `gov-vote:treasury:${parentId}:${p.proposalId}`,
        parentId,
        titleKey: 'governance.alerts.prompt.voteNeededTitle',
        bodyKey: 'governance.alerts.prompt.voteNeededTreasury',
        bodyValues: { id: p.proposalId },
        urgency: urgencyFor('vote_needed'),
      });
    }
  }

  // Vote-needed (treasury captain)
  if (captainGate.enabled) {
    for (const p of captainVotableProposals(params.proposals)) {
      if (params.treasuryVoteMap[p.proposalId]) continue;
      const sid = `gov-vote:treasury-captain:${parentId}:${p.proposalId}`;
      if (out.some((x) => x.sourceEventId === sid || x.sourceEventId === `gov-vote:treasury:${parentId}:${p.proposalId}`)) {
        continue;
      }
      out.push({
        kind: 'vote_needed',
        sourceEventId: sid,
        parentId,
        titleKey: 'governance.alerts.prompt.voteNeededTitle',
        bodyKey: 'governance.alerts.prompt.voteNeededTreasuryCaptain',
        bodyValues: { id: p.proposalId },
        urgency: urgencyFor('vote_needed'),
      });
    }
  }

  // Vote-needed (mutiny) — not yet executable
  if (
    crewGate.enabled &&
    isMutinyActive(params.mutinyStatus) &&
    params.mutinyStatus &&
    !params.mutinyHasVoted &&
    !isMutinyExecutable(params.mutinyStatus)
  ) {
    const id = params.mutinyStatus.activeMutinyId;
    out.push({
      kind: 'vote_needed',
      sourceEventId: `gov-vote:mutiny:${parentId}:${id}`,
      parentId,
      titleKey: 'governance.alerts.prompt.voteNeededTitle',
      bodyKey: 'governance.alerts.prompt.voteNeededMutiny',
      bodyValues: { id },
      urgency: urgencyFor('vote_needed'),
    });
  }

  // Delay-unlock (crew only)
  for (const card of cards) {
    if (card.kind !== 'crew_add' && card.kind !== 'crew_remove') continue;
    if (card.status !== 'pending') continue;
    out.push({
      kind: 'delay_unlock',
      sourceEventId: `gov-delay:${card.kind}:${parentId}:${card.address.toLowerCase()}`,
      parentId,
      titleKey: 'governance.alerts.prompt.delayUnlockTitle',
      bodyKey:
        card.kind === 'crew_add'
          ? 'governance.alerts.prompt.delayUnlockCrewAdd'
          : 'governance.alerts.prompt.delayUnlockCrewRemove',
      bodyValues: {
        when: new Date(card.executableAt * 1000).toLocaleString(),
      },
      unlockAtSec: card.executableAt,
      urgency: urgencyFor('delay_unlock'),
    });
  }

  out.sort((a, b) => a.urgency - b.urgency || a.sourceEventId.localeCompare(b.sourceEventId));

  // Dedupe by sourceEventId
  const seen = new Set<string>();
  const deduped: GovActionPrompt[] = [];
  for (const p of out) {
    if (seen.has(p.sourceEventId)) continue;
    seen.add(p.sourceEventId);
    deduped.push(p);
  }

  return deduped.slice(0, max);
}
