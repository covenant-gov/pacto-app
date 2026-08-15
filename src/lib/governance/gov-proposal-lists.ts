import type { MutinyStatusDto, TreasuryProposalDto } from './api';

/** Proposals in crew voting phase. */
export function crewVotableProposals(proposals: TreasuryProposalDto[]): TreasuryProposalDto[] {
  return proposals.filter((p) => p.status === 'active' && !p.executed);
}

/** Proposals awaiting captain approval after crew pass. */
export function captainVotableProposals(proposals: TreasuryProposalDto[]): TreasuryProposalDto[] {
  return proposals.filter(
    (p) => p.status === 'active_passed_crew' && !p.captainDefeated && !p.captainApproved && !p.executed,
  );
}

/** Treasury proposals executable on-chain (crew pass + captain approval). */
export function executableTreasuryProposals(proposals: TreasuryProposalDto[]): TreasuryProposalDto[] {
  return proposals.filter(
    (p) => p.status === 'active_passed_crew' && p.captainApproved && !p.executed,
  );
}

export function isMutinyActive(status: MutinyStatusDto | null | undefined): boolean {
  return !!status && status.activeMutinyId !== '0' && !status.executed;
}

export function isMutinyExecutable(status: MutinyStatusDto | null | undefined): boolean {
  if (!isMutinyActive(status) || !status) return false;
  return status.yeas >= status.snapshot && status.snapshot > 0;
}

export function proposalSelectLabel(p: TreasuryProposalDto): string {
  return `#${p.proposalId} · yeas ${p.yeas} / nays ${p.nays}`;
}
