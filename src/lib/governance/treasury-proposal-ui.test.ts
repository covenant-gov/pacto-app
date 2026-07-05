import { describe, expect, it } from 'vitest';
import {
  isTreasuryProposalActive,
  isTreasuryProposalPast,
  resolveProposalVoteUiState,
  treasuryProposalOutcomeLabel,
} from './treasury-proposal-ui';
import { treasuryProposalStatusLabel } from './pacto-gov-payload';
import type { TreasuryProposalDto } from './api';

const BASE_PROPOSAL: TreasuryProposalDto = {
  proposalId: '1',
  proposer: '0xabc',
  to: '0xdef',
  valueWei: '1000',
  operation: 'call',
  dataHex: '0x',
  deadline: 1000,
  snapshot: 1,
  yeas: 0,
  nays: 0,
  captainApproved: false,
  captainDefeated: false,
  executed: false,
  status: 'active',
};

describe('treasury proposal status helpers', () => {
  it('isTreasuryProposalActive returns true for active statuses', () => {
    expect(isTreasuryProposalActive('active')).toBe(true);
    expect(isTreasuryProposalActive('active_passed_crew')).toBe(true);
  });

  it('isTreasuryProposalActive returns false for non-active statuses', () => {
    expect(isTreasuryProposalActive('executed')).toBe(false);
    expect(isTreasuryProposalActive('captain_vetoed')).toBe(false);
    expect(isTreasuryProposalActive('expired')).toBe(false);
  });

  it('isTreasuryProposalPast is the inverse of active', () => {
    expect(isTreasuryProposalPast('active')).toBe(false);
    expect(isTreasuryProposalPast('executed')).toBe(true);
  });

  it('treasuryProposalOutcomeLabel returns labels for terminal statuses', () => {
    expect(treasuryProposalOutcomeLabel('executed')).toBe('Passed — executed');
    expect(treasuryProposalOutcomeLabel('captain_vetoed')).toBe('Failed — captain veto');
    expect(treasuryProposalOutcomeLabel('expired')).toBe('Failed — expired');
    expect(treasuryProposalOutcomeLabel('active_passed_crew')).toBe(
      'Crew passed — awaiting captain / execute',
    );
    expect(treasuryProposalOutcomeLabel('active')).toBeNull();
    expect(treasuryProposalOutcomeLabel('unknown')).toBeNull();
  });

  it('treasuryProposalStatusLabel returns status labels', () => {
    expect(treasuryProposalStatusLabel('executed')).toBe('Executed');
    expect(treasuryProposalStatusLabel('captain_vetoed')).toBe('Captain vetoed');
    expect(treasuryProposalStatusLabel('expired')).toBe('Expired');
    expect(treasuryProposalStatusLabel('active_passed_crew')).toBe(
      'Crew passed — awaiting captain / execute',
    );
    expect(treasuryProposalStatusLabel('active')).toBe('Active');
    expect(treasuryProposalStatusLabel('unknown')).toBe('unknown');
  });
});

describe('resolveProposalVoteUiState', () => {
  it('returns not_voted for past proposals regardless of other params', () => {
    expect(
      resolveProposalVoteUiState({
        proposal: { ...BASE_PROPOSAL, status: 'executed' },
        hasVoted: undefined,
        voterAddress: '',
      }),
    ).toBe('not_voted');
  });

  it('returns no_evm for active proposals without voter address', () => {
    expect(
      resolveProposalVoteUiState({
        proposal: BASE_PROPOSAL,
        hasVoted: undefined,
        voterAddress: ' ',
      }),
    ).toBe('no_evm');
  });

  it('returns loading when hasVoted is undefined', () => {
    expect(
      resolveProposalVoteUiState({
        proposal: BASE_PROPOSAL,
        hasVoted: undefined,
        voterAddress: '0xabc',
      }),
    ).toBe('loading');
  });

  it('returns voted when hasVoted is true', () => {
    expect(
      resolveProposalVoteUiState({
        proposal: BASE_PROPOSAL,
        hasVoted: true,
        voterAddress: '0xabc',
      }),
    ).toBe('voted');
  });

  it('returns not_voted when hasVoted is false', () => {
    expect(
      resolveProposalVoteUiState({
        proposal: BASE_PROPOSAL,
        hasVoted: false,
        voterAddress: '0xabc',
      }),
    ).toBe('not_voted');
  });
});
