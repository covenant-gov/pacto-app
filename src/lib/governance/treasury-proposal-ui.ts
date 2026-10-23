import type { TreasuryProposalDto } from './api';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

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
      return get(t)('governance.treasuryProposal.outcome.executed');
    case 'captain_vetoed':
      return get(t)('governance.treasuryProposal.outcome.captainVetoed');
    case 'expired':
      return get(t)('governance.treasuryProposal.outcome.expired');
    case 'active_passed_crew':
      return get(t)('governance.treasuryProposal.status.crewPassed');
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
