import type {
  CrewOffboardDto,
  MutinyRoundDto,
  MutinyStatusDto,
  QuartermasterPendingActionDto,
  TreasuryProposalDto,
} from './api';
import { isCrewOffboardActive } from './crew-offboard';
import { isMutinyActive } from './gov-proposal-lists';
import { PRODUCTION_QUORUM_BPS } from './squad-params';

export type CrewPendingKind = 'crew_add' | 'crew_remove';

/** Status-board filter. Offboard and crew add/remove only exist while open. */
export type GovProcessPhase = 'open' | 'executed' | 'failed';

export type GovProcessCard =
  | { kind: 'treasury'; proposal: TreasuryProposalDto; sortKey: number }
  | { kind: 'mutiny'; status: MutinyStatusDto; phase: GovProcessPhase; sortKey: number }
  | { kind: 'crew_offboard'; status: CrewOffboardDto; quorumBps: number; sortKey: number }
  | {
      kind: CrewPendingKind;
      address: string;
      executableAt: number;
      status: 'pending' | 'executable';
      sortKey: number;
    };

export function crewPendingStatus(
  executableAt: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): 'pending' | 'executable' {
  return executableAt > 0 && nowSec >= executableAt ? 'executable' : 'pending';
}

export function parseExecutableAt(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Treasury row bucket. Losing votes stay open until the deadline or a captain veto. */
export function treasuryProcessPhase(status: string): GovProcessPhase {
  if (status === 'executed') return 'executed';
  if (status === 'active' || status === 'active_passed_crew') return 'open';
  return 'failed';
}

export function govProcessPhase(card: GovProcessCard): GovProcessPhase {
  switch (card.kind) {
    case 'treasury':
      return treasuryProcessPhase(card.proposal.status);
    case 'mutiny':
      return card.phase;
    case 'crew_offboard':
    case 'crew_add':
    case 'crew_remove':
      return 'open';
  }
}

function mutinyCardFromRound(round: MutinyRoundDto, phase: GovProcessPhase): GovProcessCard {
  return {
    kind: 'mutiny',
    phase,
    sortKey: Number(round.id) || 0,
    status: {
      activeMutinyId: round.id,
      proposedNewCaptain: round.proposedNewCaptain,
      fromCaptain: round.fromCaptain,
      startedAt: round.startedAt,
      deadline: round.deadline,
      snapshot: round.snapshot,
      yeas: round.yeas,
      executed: round.executed,
      seatFormerCaptain: round.seatFormerCaptain,
      captain: round.captain?.trim() ?? '',
    },
  };
}

export function buildGovProcessCards(params: {
  treasuryProposals: TreasuryProposalDto[];
  mutinyStatus: MutinyStatusDto | null | undefined;
  mutinyRounds?: MutinyRoundDto[];
  qmPending: QuartermasterPendingActionDto[];
  crewOffboard?: CrewOffboardDto | null;
  crewOffboardQuorumBps?: number;
  nowSec?: number;
}): GovProcessCard[] {
  const now = params.nowSec ?? Math.floor(Date.now() / 1000);
  const out: GovProcessCard[] = [];

  for (const proposal of params.treasuryProposals) {
    out.push({
      kind: 'treasury',
      proposal,
      sortKey: Number(proposal.proposalId) || 0,
    });
  }

  const live = isMutinyActive(params.mutinyStatus) ? params.mutinyStatus : null;
  const liveId = live?.activeMutinyId?.trim() ?? '';
  if (live) {
    out.push({
      kind: 'mutiny',
      status: live,
      phase: 'open',
      sortKey: Number(live.activeMutinyId) || 0,
    });
  }

  for (const round of params.mutinyRounds ?? []) {
    const id = round.id?.trim() ?? '';
    if (!id || id === '0' || !(round.startedAt > 0)) continue;
    if (liveId && id === liveId) continue;
    if (round.executed) {
      out.push(mutinyCardFromRound(round, 'executed'));
      continue;
    }
    const phase: GovProcessPhase = round.deadline > now ? 'open' : 'failed';
    out.push(mutinyCardFromRound(round, phase));
  }

  if (params.crewOffboard && isCrewOffboardActive(params.crewOffboard)) {
    out.push({
      kind: 'crew_offboard',
      status: params.crewOffboard,
      quorumBps: params.crewOffboardQuorumBps ?? PRODUCTION_QUORUM_BPS,
      sortKey: Number(params.crewOffboard.offboardId) || 0,
    });
  }

  for (const row of params.qmPending) {
    if (row.kind !== 'add' && row.kind !== 'remove') continue;
    const executableAt = parseExecutableAt(row.executableAt);
    if (!executableAt || !row.address?.trim()) continue;
    const kind: CrewPendingKind = row.kind === 'remove' ? 'crew_remove' : 'crew_add';
    out.push({
      kind,
      address: row.address.trim(),
      executableAt,
      status: crewPendingStatus(executableAt, now),
      sortKey: executableAt,
    });
  }

  return sortGovProcessCards(out);
}

/** Active processes first, then by sortKey descending (newer / later unlock first). */
export function sortGovProcessCards(cards: GovProcessCard[]): GovProcessCard[] {
  return [...cards].sort((a, b) => {
    const aActive = isGovProcessActive(a) ? 1 : 0;
    const bActive = isGovProcessActive(b) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return b.sortKey - a.sortKey;
  });
}

export function isGovProcessActive(card: GovProcessCard): boolean {
  return govProcessPhase(card) === 'open';
}

export function countOpenGovProcesses(cards: GovProcessCard[]): number {
  return cards.filter(isGovProcessActive).length;
}

/** i18n key for the process tool badge. */
export function govProcessToolLabel(card: GovProcessCard): string {
  switch (card.kind) {
    case 'treasury':
      return 'governance.title.treasuryAuthority';
    case 'mutiny':
      return 'governance.title.mutiny';
    case 'crew_offboard':
      return 'governance.title.crewOffboard';
    case 'crew_add':
    case 'crew_remove':
      return 'governance.title.quartermaster';
  }
}

export function govProcessCardKey(card: GovProcessCard): string {
  switch (card.kind) {
    case 'treasury':
      return `treasury:${card.proposal.proposalId}`;
    case 'mutiny':
      return `mutiny:${card.status.activeMutinyId}`;
    case 'crew_offboard':
      return `crew_offboard:${card.status.offboardId}`;
    case 'crew_add':
      return `crew_add:${card.address.toLowerCase()}`;
    case 'crew_remove':
      return `crew_remove:${card.address.toLowerCase()}`;
  }
}
