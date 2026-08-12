import { describe, expect, it } from 'vitest';
import { govExecuteUiState } from './gov-execute-ui';
import type { GovProcessCard } from './gov-process';
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

function crewCard(overrides: {
  address?: string;
  executableAt?: number;
  status?: 'pending' | 'executable';
  sortKey?: number;
} = {}): GovProcessCard {
  return {
    kind: 'crew_add',
    address: overrides.address ?? '0xADD',
    executableAt: overrides.executableAt ?? 200,
    status: overrides.status ?? 'pending',
    sortKey: overrides.sortKey ?? overrides.executableAt ?? 200,
  };
}

describe('govExecuteUiState', () => {
  it('crew: visible-disabled before unlock, enabled at and after', () => {
    const card = crewCard({ executableAt: 200, status: 'pending' });
    expect(govExecuteUiState({ card, nowSec: 199 })).toMatchObject({
      showExecute: true,
      executeEnabled: false,
      disabledReasonKey: 'governance.proposal.executeLockedUntil',
      unlockAtSec: 200,
    });
    expect(govExecuteUiState({ card, nowSec: 200 })).toMatchObject({
      showExecute: true,
      executeEnabled: true,
      disabledReasonKey: '',
      unlockAtSec: 200,
    });
    expect(govExecuteUiState({ card, nowSec: 201 })).toMatchObject({
      showExecute: true,
      executeEnabled: true,
      disabledReasonKey: '',
    });
  });

  it('crew: privilege deny while unlocked keeps Execute visible-disabled', () => {
    const card = crewCard({ executableAt: 100, status: 'executable' });
    expect(
      govExecuteUiState({
        card,
        privilegeReasonKey: 'governance.gate.quartermasterLocked',
        nowSec: 100,
      }),
    ).toMatchObject({
      showExecute: true,
      executeEnabled: false,
      disabledReasonKey: 'governance.gate.quartermasterLocked',
      unlockAtSec: 100,
    });
  });

  it('crew: delay reason wins over privilege while locked', () => {
    const card = crewCard({ executableAt: 200, status: 'pending' });
    expect(
      govExecuteUiState({
        card,
        privilegeReasonKey: 'governance.gate.linkSquadEvmAddressToSign',
        nowSec: 50,
      }),
    ).toMatchObject({
      showExecute: true,
      executeEnabled: false,
      disabledReasonKey: 'governance.proposal.executeLockedUntil',
    });
  });

  it('treasury: hidden until passed; privilege disables when shown', () => {
    const voting: GovProcessCard = {
      kind: 'treasury',
      proposal: treasury({ status: 'active' }),
      sortKey: 1,
    };
    expect(govExecuteUiState({ card: voting })).toMatchObject({
      showExecute: false,
      executeEnabled: false,
      disabledReasonKey: '',
      unlockAtSec: null,
    });

    const passed: GovProcessCard = {
      kind: 'treasury',
      proposal: treasury({ status: 'active_passed_crew' }),
      sortKey: 1,
    };
    expect(govExecuteUiState({ card: passed })).toMatchObject({
      showExecute: true,
      executeEnabled: true,
      disabledReasonKey: '',
    });
    expect(
      govExecuteUiState({
        card: passed,
        privilegeReasonKey: 'governance.gate.linkSquadEvmAddressToSign',
      }),
    ).toMatchObject({
      showExecute: true,
      executeEnabled: false,
      disabledReasonKey: 'governance.gate.linkSquadEvmAddressToSign',
    });
  });

  it('mutiny: hidden below threshold; shown at threshold', () => {
    const below: GovProcessCard = {
      kind: 'mutiny',
      status: mutiny({ yeas: 1, snapshot: 3 }),
      sortKey: 2,
    };
    expect(govExecuteUiState({ card: below })).toMatchObject({
      showExecute: false,
      executeEnabled: false,
    });

    const ready: GovProcessCard = {
      kind: 'mutiny',
      status: mutiny({ yeas: 3, snapshot: 3 }),
      sortKey: 2,
    };
    expect(govExecuteUiState({ card: ready })).toMatchObject({
      showExecute: true,
      executeEnabled: true,
      disabledReasonKey: '',
    });
  });
});
