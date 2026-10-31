import type { MutinyStatusDto, TreasuryProposalDto } from './api';

/** Captain vote recorded, or the list marked the Safe as wearing the captain hat. */
export function treasuryCaptainSatisfied(proposal: TreasuryProposalDto): boolean {
  return proposal.captainSatisfied ?? proposal.captainApproved;
}

/** Proposals in crew voting phase. */
export function crewVotableProposals(proposals: TreasuryProposalDto[]): TreasuryProposalDto[] {
  return proposals.filter((p) => p.status === 'active' && !p.executed);
}

/** Proposals awaiting captain approval after crew pass. */
export function captainVotableProposals(proposals: TreasuryProposalDto[]): TreasuryProposalDto[] {
  return proposals.filter(
    (p) =>
      p.status === 'active_passed_crew' &&
      !p.captainDefeated &&
      !treasuryCaptainSatisfied(p) &&
      !p.executed,
  );
}

/** Treasury proposals executable on-chain (crew pass and captain path). */
export function executableTreasuryProposals(proposals: TreasuryProposalDto[]): TreasuryProposalDto[] {
  return proposals.filter(
    (p) => p.status === 'active_passed_crew' && treasuryCaptainSatisfied(p) && !p.executed,
  );
}

export function isMutinyActive(status: MutinyStatusDto | null | undefined): boolean {
  return !!status && status.activeMutinyId !== '0' && !status.executed;
}

export function isMutinyPastDeadline(
  status: MutinyStatusDto | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!isMutinyActive(status) || !status) return false;
  return (status.deadline ?? 0) > 0 && nowSec >= (status.deadline ?? 0);
}

export function isMutinyExecutable(
  status: MutinyStatusDto | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!isMutinyActive(status) || !status) return false;
  if (isMutinyPastDeadline(status, nowSec)) return false;
  return status.snapshot > 0 && status.yeas * 2 > status.snapshot;
}

export function isMutinyExpirable(
  status: MutinyStatusDto | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  return isMutinyPastDeadline(status, nowSec);
}

export function proposalSelectLabel(p: TreasuryProposalDto): string {
  return `#${p.proposalId} · yeas ${p.yeas} / nays ${p.nays}`;
}
