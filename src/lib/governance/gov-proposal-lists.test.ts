import { describe, expect, it } from 'vitest';
import {
  captainVotableProposals,
  crewVotableProposals,
  executableTreasuryProposals,
  isMutinyActive,
  isMutinyExecutable,
} from './gov-proposal-lists';
import type { MutinyStatusDto, TreasuryProposalDto } from './api';

function proposal(overrides: Partial<TreasuryProposalDto>): TreasuryProposalDto {
  return {
    proposalId: '1',
    proposer: '0x1',
    to: '0x2',
    valueWei: '0',
    operation: 'call',
    dataHex: '0x',
    deadline: 0,
    snapshot: 10,
    yeas: 0,
    nays: 0,
    captainApproved: false,
    captainDefeated: false,
    executed: false,
    status: 'active',
    ...overrides,
  };
}

describe('gov-proposal-lists', () => {
  it('filters crew and captain votable proposals', () => {
    const proposals = [
      proposal({ proposalId: '1', status: 'active' }),
      proposal({ proposalId: '2', status: 'active_passed_crew' }),
      proposal({ proposalId: '3', status: 'active_passed_crew', captainApproved: true }),
    ];
    expect(crewVotableProposals(proposals).map((p) => p.proposalId)).toEqual(['1']);
    expect(captainVotableProposals(proposals).map((p) => p.proposalId)).toEqual(['2']);
  });

  it('lists executable treasury proposals only after captain approval', () => {
    const proposals = [
      proposal({ status: 'active' }),
      proposal({ status: 'active_passed_crew' }),
      proposal({ status: 'active_passed_crew', captainApproved: true }),
      proposal({ status: 'active_passed_crew', captainApproved: true, executed: true }),
    ];
    expect(executableTreasuryProposals(proposals)).toHaveLength(1);
    expect(executableTreasuryProposals(proposals)[0]?.captainApproved).toBe(true);
  });

  it('detects mutiny active and executable', () => {
    const inactive: MutinyStatusDto = {
      activeMutinyId: '0',
      proposedNewCaptain: '',
      startedAt: 0,
      snapshot: 0,
      yeas: 0,
      executed: false,
      captain: '0x1',
    };
    const active: MutinyStatusDto = {
      ...inactive,
      activeMutinyId: '1',
      snapshot: 5,
      yeas: 5,
    };
    expect(isMutinyActive(inactive)).toBe(false);
    expect(isMutinyActive(active)).toBe(true);
    expect(isMutinyExecutable(active)).toBe(true);
  });
});
