import { describe, expect, it } from 'vitest';
import {
  buildGovProcessCards,
  countOpenGovProcesses,
  crewPendingStatus,
  govProcessCardKey,
  govProcessPhase,
  govProcessToolLabel,
  parseExecutableAt,
  sortGovProcessCards,
  type GovProcessCard,
} from './gov-process';
import type { MutinyRoundDto, MutinyStatusDto, TreasuryProposalDto } from './api';

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

function round(overrides: Partial<MutinyRoundDto> = {}): MutinyRoundDto {
  return {
    id: '3',
    proposedNewCaptain: '0xabc',
    startedAt: 1,
    deadline: 50,
    snapshot: 3,
    yeas: 1,
    executed: false,
    ...overrides,
  };
}

function mutiny(overrides: Partial<MutinyStatusDto> = {}): MutinyStatusDto {
  return {
    activeMutinyId: '2',
    proposedNewCaptain: '0xabc',
    startedAt: 1,
    deadline: 0,
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
    expect(govProcessToolLabel(cards[0])).toBe('governance.title.treasuryAuthority');
    expect(govProcessCardKey(cards[0])).toBe('treasury:1');
  });

  it('includes an active crew offboard on the board', () => {
    const cards = buildGovProcessCards({
      treasuryProposals: [],
      mutinyStatus: null,
      qmPending: [],
      crewOffboard: {
        offboardId: '4',
        target: '0xabc',
        proposer: '0xdef',
        deadline: 400,
        snapshot: 10,
        yeas: 2,
        nays: 1,
        executed: false,
      },
      crewOffboardQuorumBps: 3000,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: 'crew_offboard', sortKey: 4, quorumBps: 3000 });
    expect(govProcessToolLabel(cards[0])).toBe('governance.title.crewOffboard');
    expect(govProcessCardKey(cards[0])).toBe('crew_offboard:4');
  });

  it('skips unknown quartermaster pending kinds', () => {
    const cards = buildGovProcessCards({
      treasuryProposals: [],
      mutinyStatus: null,
      qmPending: [
        { kind: 'add', address: '0xADD', executableAt: '200' },
        // @ts-expect-error intentional invalid wire kind
        { kind: 'weird', address: '0xBAD', executableAt: '200' },
      ],
      nowSec: 200,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe('crew_add');
  });

  it('classifies treasury and mutiny history, and keeps offboard and crew open-only', () => {
    const live = mutiny({ activeMutinyId: '8', deadline: 10, executed: false });
    const cards = buildGovProcessCards({
      treasuryProposals: [
        treasury({ proposalId: '1', status: 'active' }),
        treasury({ proposalId: '2', status: 'executed', executed: true }),
        treasury({ proposalId: '3', status: 'expired' }),
        treasury({ proposalId: '4', status: 'captain_vetoed', captainDefeated: true }),
        treasury({ proposalId: '5', status: 'active', yeas: 0, nays: 9 }),
      ],
      mutinyStatus: live,
      mutinyRounds: [
        round({ id: '8', executed: false, deadline: 10 }),
        round({ id: '6', executed: true }),
        round({ id: '4', executed: false, startedAt: 1 }),
        round({ id: '1', startedAt: 0 }),
      ],
      qmPending: [{ kind: 'add', address: '0xADD', executableAt: '200' }],
      crewOffboard: {
        offboardId: '4',
        target: '0xabc',
        proposer: '0xdef',
        deadline: 1,
        snapshot: 10,
        yeas: 0,
        nays: 1,
        executed: false,
      },
      nowSec: 500,
    });

    const phaseOf = (kind: string, sortKey: number) =>
      govProcessPhase(cards.find((c) => c.kind === kind && c.sortKey === sortKey)!);

    expect(phaseOf('treasury', 1)).toBe('open');
    expect(phaseOf('treasury', 5)).toBe('open');
    expect(phaseOf('treasury', 2)).toBe('executed');
    expect(phaseOf('treasury', 3)).toBe('failed');
    expect(phaseOf('treasury', 4)).toBe('failed');
    expect(phaseOf('mutiny', 8)).toBe('open');
    expect(cards.filter((c) => c.kind === 'mutiny' && c.sortKey === 8)).toHaveLength(1);
    expect(phaseOf('mutiny', 6)).toBe('executed');
    expect(phaseOf('mutiny', 4)).toBe('failed');
    expect(cards.some((c) => c.kind === 'mutiny' && c.sortKey === 1)).toBe(false);
    expect(phaseOf('crew_offboard', 4)).toBe('open');
    expect(phaseOf('crew_add', 200)).toBe('open');
    expect(cards.filter((c) => govProcessPhase(c) === 'executed').map((c) => c.kind).sort()).toEqual([
      'mutiny',
      'treasury',
    ]);
    expect(cards.filter((c) => govProcessPhase(c) === 'failed').every((c) => c.kind !== 'crew_offboard')).toBe(
      true,
    );
  });

  it('does not mark a closed mutiny failed before live status is known', () => {
    const cards = buildGovProcessCards({
      treasuryProposals: [],
      mutinyStatus: null,
      mutinyRounds: [round({ id: '4', executed: false }), round({ id: '6', executed: true })],
      qmPending: [],
    });
    expect(cards.map((c) => ({ sortKey: c.sortKey, phase: c.kind === 'mutiny' ? c.phase : '' }))).toEqual([
      { sortKey: 6, phase: 'executed' },
    ]);
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
