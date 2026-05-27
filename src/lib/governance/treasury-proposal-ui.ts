import type { TreasuryProposalDto } from './api';

const ACTIVE_STATUSES = new Set(['active', 'active_passed_crew']);

export function isTreasuryProposalActive(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function isTreasuryProposalPast(status: string): boolean {
  return !isTreasuryProposalActive(status);
}

export function treasuryProposalOutcomeLabel(status: string): string | null {
  switch (status) {
    case 'executed':
      return 'Passed — executed';
    case 'captain_vetoed':
      return 'Failed — captain veto';
    case 'expired':
      return 'Failed — expired';
    case 'active_passed_crew':
      return 'Crew passed — awaiting captain / execute';
    default:
      return null;
  }
}

export type ProposalVoteUiState = 'loading' | 'no_evm' | 'voted' | 'not_voted' | 'unknown';

export function resolveProposalVoteUiState(params: {
  proposal: TreasuryProposalDto;
  hasVoted: boolean | undefined;
  voterAddress: string;
}): ProposalVoteUiState {
  if (!isTreasuryProposalActive(params.proposal.status)) return 'not_voted';
  if (!params.voterAddress.trim()) return 'no_evm';
  if (params.hasVoted === undefined) return 'loading';
  if (params.hasVoted === true) return 'voted';
  return 'not_voted';
}
