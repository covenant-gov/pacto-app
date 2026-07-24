import type {
  MutinyStatusDto,
  QuartermasterPendingActionDto,
  TreasuryProposalDto,
} from './api';
import { isMutinyActive } from './gov-proposal-lists';
import { isTreasuryProposalActive } from './treasury-proposal-ui';

export type CrewPendingKind = 'crew_add' | 'crew_remove';

export type GovProcessCard =
  | { kind: 'treasury'; proposal: TreasuryProposalDto; sortKey: number }
  | { kind: 'mutiny'; status: MutinyStatusDto; sortKey: number }
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

export function buildGovProcessCards(params: {
  treasuryProposals: TreasuryProposalDto[];
  mutinyStatus: MutinyStatusDto | null | undefined;
  qmPending: QuartermasterPendingActionDto[];
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

  if (isMutinyActive(params.mutinyStatus) && params.mutinyStatus) {
    out.push({
      kind: 'mutiny',
      status: params.mutinyStatus,
      sortKey: Number(params.mutinyStatus.activeMutinyId) || 0,
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
  switch (card.kind) {
    case 'treasury':
      return isTreasuryProposalActive(card.proposal.status);
    case 'mutiny':
      return isMutinyActive(card.status);
    case 'crew_add':
    case 'crew_remove':
      return true;
  }
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
    case 'crew_add':
      return `crew_add:${card.address.toLowerCase()}`;
    case 'crew_remove':
      return `crew_remove:${card.address.toLowerCase()}`;
  }
}
