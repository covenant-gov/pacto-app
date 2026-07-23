import { describe, expect, it } from 'vitest';
import {
  buildGovProcessCards,
  countOpenGovProcesses,
  crewPendingStatus,
  govProcessCardKey,
  govProcessToolLabel,
  parseExecutableAt,
  sortGovProcessCards,
  type GovProcessCard,
} from './gov-process';
import type { MutinyStatusDto, TreasuryProposalDto } from './api';

function treasury(overrides: Partial<TreasuryProposalDto> = {}): TreasuryProposalDto {
  return {
    proposalId: '1',
    proposer: '0x1',
    to: '0x2',
    valueWei: '0',
    operation: 'CALL',
    dataHex: '0x',
    deadline: 1_800_000_000,
    snapshot: 3,
    yeas: 1,
    nays: 0,
    captainApproved: false,
    captainDefeated: false,
    executed: false,
    status: 'active',
    ...overrides,
  };
}

function mutiny(overrides: Partial<MutinyStatusDto> = {}): MutinyStatusDto {
  return {
    activeMutinyId: '2',
    proposedNewCaptain: '0xabc',
    startedAt: 1,
    snapshot: 3,
    yeas: 1,
    executed: false,
    captain: '0xcap',
    ...overrides,
  };
}

describe('gov-process helpers', () => {
  it('parseExecutableAt and crewPendingStatus', () => {
    expect(parseExecutableAt('1785277740')).toBe(1785277740);
    expect(parseExecutableAt('0')).toBe(0);
    expect(parseExecutableAt('bad')).toBe(0);
    expect(crewPendingStatus(100, 99)).toBe('pending');
    expect(crewPendingStatus(100, 100)).toBe('executable');
  });

  it('buildGovProcessCards merges treasury, active mutiny, and qm pending', () => {
    const cards = buildGovProcessCards({
      treasuryProposals: [treasury({ proposalId: '5', status: 'executed' }), treasury({ proposalId: '9' })],
      mutinyStatus: mutiny(),
      qmPending: [
        { kind: 'add', address: '0xADD', executableAt: '200' },
        { kind: 'remove', address: '0xREM', executableAt: '50' },
        { kind: 'add', address: '0xZERO', executableAt: '0' },
      ],
      nowSec: 100,
    });
    // Active first, then sortKey descending.
    expect(cards.map((c) => ({ kind: c.kind, sortKey: c.sortKey }))).toEqual([
      { kind: 'crew_add', sortKey: 200 },
      { kind: 'crew_remove', sortKey: 50 },
      { kind: 'treasury', sortKey: 9 },
      { kind: 'mutiny', sortKey: 2 },
      { kind: 'treasury', sortKey: 5 },
    ]);
    const add = cards.find((c) => c.kind === 'crew_add');
    expect(add?.kind).toBe('crew_add');
    if (add?.kind === 'crew_add') {
      expect(add.status).toBe('pending');
    }
    const unlocked = buildGovProcessCards({
      treasuryProposals: [],
      mutinyStatus: null,
      qmPending: [{ kind: 'add', address: '0xADD', executableAt: '200' }],
      nowSec: 200,
    });
    expect(unlocked[0]).toMatchObject({ kind: 'crew_add', status: 'executable' });
    expect(countOpenGovProcesses(cards)).toBe(4);
  });

  it('omits inactive mutiny and labels tools', () => {
    const cards = buildGovProcessCards({
      treasuryProposals: [treasury()],
      mutinyStatus: mutiny({ activeMutinyId: '0' }),
      qmPending: [],
    });
    expect(cards).toHaveLength(1);
    expect(govProcessToolLabel(cards[0])).toBe('Treasury Authority');
    expect(govProcessCardKey(cards[0])).toBe('treasury:1');
  });

  it('sortGovProcessCards puts active before past', () => {
    const past: GovProcessCard = {
      kind: 'treasury',
      proposal: treasury({ proposalId: '99', status: 'executed' }),
      sortKey: 99,
    };
    const active: GovProcessCard = {
      kind: 'treasury',
      proposal: treasury({ proposalId: '1', status: 'active' }),
      sortKey: 1,
    };
    expect(sortGovProcessCards([past, active]).map((c) => c.sortKey)).toEqual([1, 99]);
  });
});
