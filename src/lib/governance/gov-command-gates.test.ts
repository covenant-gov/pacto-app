import { describe, expect, it } from 'vitest';
import { buildGovCommandGates } from './gov-command-gates';
import type { GovernancePrivilege } from './governance-privilege';
import type { MutinyStatusDto, QuartermasterStatusDto } from './api';

const ADDR = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

function privilege(overrides: Partial<GovernancePrivilege> = {}): GovernancePrivilege {
  return {
    myAddress: ADDR,
    wearsCaptain: false,
    wearsCrew: false,
    captainIsSafe: false,
    roleLabel: 'governance.roleLabel.noOnChainHat',
    ...overrides,
  };
}

function mutiny(overrides: Partial<MutinyStatusDto> = {}): MutinyStatusDto {
  return {
    activeMutinyId: '9',
    proposedNewCaptain: OTHER,
    startedAt: 1,
    deadline: 0,
    snapshot: 3,
    yeas: 1,
    executed: false,
    captain: ADDR,
    ...overrides,
  };
}

function qm(overrides: Partial<QuartermasterStatusDto> = {}): QuartermasterStatusDto {
  return {
    crewChangeDelaySecs: '0',
    mutinyActive: false,
    activeCrewOffboardId: '0',
    crewOffboardExpirySecs: '0',
    crewOffboardQuorumBps: '0',
    ...overrides,
  };
}

describe('buildGovCommandGates', () => {
  it('enables treasury and crew actions for a crew wearer', () => {
    const gates = buildGovCommandGates({
      privilege: privilege({ wearsCrew: true, roleLabel: 'governance.roleLabel.crew' }),
      capabilitiesPending: false,
    });
    expect(gates.treasury.enabled).toBe(true);
    expect(gates.startMutiny.enabled).toBe(true);
    expect(gates.proposeOffboard.enabled).toBe(true);
    expect(gates.qmRoster.enabled).toBe(false);
    expect(gates.qmRoster.reason).toBe('governance.gate.requiresCaptain');
    expect(gates.resign.enabled).toBe(false);
    expect(gates.resign.reason).toBe('governance.gate.requiresCaptain');
    expect(gates.bootstrap.enabled).toBe(false);
  });

  it('enables treasury and captain actions for a captain wearer', () => {
    const gates = buildGovCommandGates({
      privilege: privilege({ wearsCaptain: true, roleLabel: 'governance.roleLabel.captain' }),
      capabilitiesPending: false,
    });
    expect(gates.treasury.enabled).toBe(true);
    expect(gates.qmRoster.enabled).toBe(true);
    expect(gates.resign.enabled).toBe(true);
    expect(gates.startMutiny.enabled).toBe(false);
    expect(gates.startMutiny.reason).toBe('governance.gate.requiresCrew');
    expect(gates.proposeOffboard.enabled).toBe(false);
    expect(gates.proposeOffboard.reason).toBe('governance.gate.requiresCrew');
  });

  it('enables every hat-gated command when the viewer wears both hats', () => {
    const gates = buildGovCommandGates({
      privilege: privilege({
        wearsCaptain: true,
        wearsCrew: true,
        roleLabel: 'governance.roleLabel.captainAndCrew',
      }),
      capabilitiesPending: false,
    });
    expect(gates.treasury.enabled).toBe(true);
    expect(gates.startMutiny.enabled).toBe(true);
    expect(gates.proposeOffboard.enabled).toBe(true);
    expect(gates.qmRoster.enabled).toBe(true);
    expect(gates.resign.enabled).toBe(true);
  });

  it('disables hat-gated commands when the viewer wears no hat', () => {
    const gates = buildGovCommandGates({
      privilege: privilege(),
      capabilitiesPending: false,
    });
    expect(gates.treasury.enabled).toBe(false);
    expect(gates.treasury.reason).toBe('governance.gate.requiresCaptainOrCrew');
    expect(gates.startMutiny.enabled).toBe(false);
    expect(gates.proposeOffboard.enabled).toBe(false);
    expect(gates.qmRoster.enabled).toBe(false);
    expect(gates.resign.enabled).toBe(false);
  });

  it('keeps destructive CTAs closed while capabilities are pending', () => {
    const gates = buildGovCommandGates({
      privilege: privilege({ wearsCaptain: true, wearsCrew: true }),
      capabilitiesPending: true,
    });
    expect(gates.treasury).toEqual({ enabled: false, reason: 'governance.status.loading' });
    expect(gates.startMutiny).toEqual({ enabled: false, reason: 'governance.status.loading' });
    expect(gates.qmRoster).toEqual({ enabled: false, reason: 'governance.status.loading' });
    expect(gates.resign).toEqual({ enabled: false, reason: 'governance.status.loading' });
  });

  it('blocks start mutiny and captain roster writes while mutiny is active', () => {
    const gates = buildGovCommandGates({
      privilege: privilege({ wearsCaptain: true, wearsCrew: true }),
      capabilitiesPending: false,
      mutinyStatus: mutiny(),
      qmStatus: qm({ mutinyActive: true }),
    });
    expect(gates.mutinyActive).toBe(true);
    expect(gates.startMutiny.reason).toBe('governance.gate.mutinyAlreadyActive');
    expect(gates.resign.reason).toBe('governance.gate.cannotResignWhileMutiny');
    expect(gates.proposeOffboard.reason).toBe('governance.gate.cannotOffboardWhileMutiny');
    expect(gates.qmRoster.reason).toBe('governance.gate.quartermasterLocked');
  });

  it('exposes bootstrap only when the quartermaster reports it available', () => {
    expect(
      buildGovCommandGates({
        privilege: privilege({ wearsCaptain: true }),
        capabilitiesPending: false,
        qmStatus: qm(),
      }).bootstrapAvailable,
    ).toBe(false);
    expect(
      buildGovCommandGates({
        privilege: privilege({ wearsCaptain: true }),
        capabilitiesPending: false,
        qmStatus: qm({ bootstrapAvailable: true }),
      }).bootstrapAvailable,
    ).toBe(true);
  });
});
