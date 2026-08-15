import { describe, expect, it } from 'vitest';
import { deriveGovActionPrompts } from './gov-action-prompts';
import type { GovernancePrivilege } from './governance-privilege';
import type { MutinyStatusDto, TreasuryProposalDto } from './api';

function privilege(overrides: Partial<GovernancePrivilege> = {}): GovernancePrivilege {
  return {
    myAddress: '0xabc',
    wearsCaptain: false,
    wearsCrew: true,
    captainIsSafe: false,
    roleLabel: 'governance.roleLabel.crew',
    ...overrides,
  };
}

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
    activeMutinyId: '9',
    proposedNewCaptain: '0xnew',
    startedAt: 1,
    snapshot: 3,
    yeas: 1,
    executed: false,
    captain: '0xcap',
    ...overrides,
  };
}

describe('deriveGovActionPrompts', () => {
  it('emits vote-needed for crew-votable proposal when not voted', () => {
    const prompts = deriveGovActionPrompts({
      parentId: 'squad-1',
      proposals: [treasury({ proposalId: '7', status: 'active' })],
      mutinyStatus: null,
      qmPending: [],
      privilege: privilege(),
      mutinyMode: false,
      treasuryVoteMap: {},
      mutinyHasVoted: false,
    });
    expect(prompts.some((p) => p.sourceEventId === 'gov-vote:treasury:squad-1:7')).toBe(true);
    expect(prompts.find((p) => p.kind === 'vote_needed')?.kind).toBe('vote_needed');
  });

  it('skips vote when already voted or privilege denies', () => {
    const voted = deriveGovActionPrompts({
      parentId: 'squad-1',
      proposals: [treasury({ status: 'active' })],
      mutinyStatus: null,
      qmPending: [],
      privilege: privilege(),
      mutinyMode: false,
      treasuryVoteMap: { '1': true },
      mutinyHasVoted: false,
    });
    expect(voted.filter((p) => p.kind === 'vote_needed')).toHaveLength(0);

    const denied = deriveGovActionPrompts({
      parentId: 'squad-1',
      proposals: [treasury({ status: 'active' })],
      mutinyStatus: null,
      qmPending: [],
      privilege: privilege({ myAddress: '', wearsCrew: false }),
      mutinyMode: false,
      treasuryVoteMap: {},
      mutinyHasVoted: false,
    });
    expect(denied.filter((p) => p.kind === 'vote_needed')).toHaveLength(0);
  });

  it('emits delay-unlock before executableAt and execute-ready at unlock', () => {
    const pending = deriveGovActionPrompts({
      parentId: 'squad-1',
      proposals: [],
      mutinyStatus: null,
      qmPending: [{ kind: 'add', address: '0xADD', executableAt: '200' }],
      privilege: privilege(),
      mutinyMode: false,
      treasuryVoteMap: {},
      mutinyHasVoted: false,
      nowSec: 100,
    });
    expect(pending.some((p) => p.kind === 'delay_unlock')).toBe(true);
    expect(pending.some((p) => p.kind === 'execute_ready')).toBe(false);

    const unlocked = deriveGovActionPrompts({
      parentId: 'squad-1',
      proposals: [],
      mutinyStatus: null,
      qmPending: [{ kind: 'add', address: '0xADD', executableAt: '200' }],
      privilege: privilege(),
      mutinyMode: false,
      treasuryVoteMap: {},
      mutinyHasVoted: false,
      nowSec: 200,
    });
    expect(unlocked.some((p) => p.kind === 'execute_ready')).toBe(true);
    expect(unlocked.some((p) => p.kind === 'delay_unlock')).toBe(false);
  });

  it('emits execute-ready for passed treasury when signer privilege allows', () => {
    const prompts = deriveGovActionPrompts({
      parentId: 'squad-1',
      proposals: [treasury({ status: 'active_passed_crew', captainApproved: true })],
      mutinyStatus: null,
      qmPending: [],
      privilege: privilege(),
      mutinyMode: false,
      treasuryVoteMap: {},
      mutinyHasVoted: false,
    });
    expect(prompts.some((p) => p.sourceEventId === 'gov-execute:treasury:squad-1:1')).toBe(true);
  });

  it('does not emit execute-ready until captainApproved', () => {
    const prompts = deriveGovActionPrompts({
      parentId: 'squad-1',
      proposals: [treasury({ status: 'active_passed_crew', captainApproved: false })],
      mutinyStatus: null,
      qmPending: [],
      privilege: privilege(),
      mutinyMode: false,
      treasuryVoteMap: {},
      mutinyHasVoted: false,
    });
    expect(prompts.some((p) => p.kind === 'execute_ready')).toBe(false);
  });

  it('emits captain vote-needed even when the crew hasVoted map is true', () => {
    const prompts = deriveGovActionPrompts({
      parentId: 'squad-1',
      proposals: [treasury({ status: 'active_passed_crew' })],
      mutinyStatus: null,
      qmPending: [],
      privilege: privilege({ wearsCaptain: true, wearsCrew: true }),
      mutinyMode: false,
      treasuryVoteMap: { '1': true },
      mutinyHasVoted: false,
    });
    expect(prompts.some((p) => p.sourceEventId === 'gov-vote:treasury-captain:squad-1:1')).toBe(
      true,
    );
  });

  it('skips mutiny vote-needed when the vote-status read is unknown', () => {
    const prompts = deriveGovActionPrompts({
      parentId: 'squad-1',
      proposals: [],
      mutinyStatus: mutiny({ yeas: 1, snapshot: 3 }),
      qmPending: [],
      privilege: privilege(),
      mutinyMode: true,
      treasuryVoteMap: {},
      mutinyHasVoted: false,
      mutinyVoteKnown: false,
    });
    expect(prompts.some((p) => p.sourceEventId === 'gov-vote:mutiny:squad-1:9')).toBe(false);
  });

  it('emits mutiny vote when active below threshold', () => {
    const prompts = deriveGovActionPrompts({
      parentId: 'squad-1',
      proposals: [],
      mutinyStatus: mutiny({ yeas: 1, snapshot: 3 }),
      qmPending: [],
      privilege: privilege(),
      mutinyMode: true,
      treasuryVoteMap: {},
      mutinyHasVoted: false,
    });
    expect(prompts.some((p) => p.sourceEventId === 'gov-vote:mutiny:squad-1:9')).toBe(true);
  });

  it('caps prompts and sorts execute before vote before delay', () => {
    const prompts = deriveGovActionPrompts({
      parentId: 'squad-1',
      proposals: [
        treasury({ proposalId: '1', status: 'active' }),
        treasury({ proposalId: '2', status: 'active_passed_crew', captainApproved: true }),
      ],
      mutinyStatus: null,
      qmPending: [
        { kind: 'add', address: '0xA1', executableAt: '500' },
        { kind: 'add', address: '0xA2', executableAt: '501' },
        { kind: 'add', address: '0xA3', executableAt: '502' },
        { kind: 'add', address: '0xA4', executableAt: '503' },
      ],
      privilege: privilege(),
      mutinyMode: false,
      treasuryVoteMap: {},
      mutinyHasVoted: false,
      nowSec: 100,
      maxPrompts: 3,
    });
    expect(prompts).toHaveLength(3);
    expect(prompts[0].kind).toBe('execute_ready');
  });
});
