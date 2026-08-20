import { describe, expect, it } from 'vitest';
import {
  gateBlockedByMutinyMode,
  gatePermissionlessSigner,
  gateRequiresCaptain,
  gateRequiresCaptainOrCrew,
  gateRequiresCrew,
  gateSquadAdminWrite,
  localizeAclReason,
  resolveGovernancePrivilege,
} from './governance-privilege';
import type { SquadCapabilitiesDto } from './api';

describe('resolveGovernancePrivilege', () => {
  it('detects captain and crew wearers', () => {
    const p = resolveGovernancePrivilege({
      myAddress: '0xAAA',
      safeAddress: '0xSAFE',
      captainWearers: ['0xaaa'],
      crewWearers: ['0xbbb'],
    });
    expect(p.wearsCaptain).toBe(true);
    expect(p.wearsCrew).toBe(false);
    expect(p.roleLabel).toBe('governance.roleLabel.captain');
  });

  it('detects Safe-as-captain', () => {
    const p = resolveGovernancePrivilege({
      myAddress: '0xAAA',
      safeAddress: '0xSAFE',
      captainWearers: ['0xsafe'],
      crewWearers: ['0xaaa'],
    });
    expect(p.captainIsSafe).toBe(true);
    expect(p.wearsCrew).toBe(true);
    expect(gateRequiresCaptain(p).enabled).toBe(false);
    expect(gateRequiresCaptain(p).reason).toBe('governance.gate.captainHatOnSafe');
    expect(gateRequiresCrew(p).enabled).toBe(true);
  });

  it('prefers capabilities snapshot when present', () => {
    const snap = {
      rosterAddress: ' 0xSNAP ',
      wearsCaptain: true,
      wearsCrew: true,
      captainIsSafe: false,
      roleLabel: '',
      capabilities: {
        crewVote: { allowed: true, reason: '' },
      },
      squadAdminFull: true,
      squadAdminPaused: false,
    } as unknown as SquadCapabilitiesDto;
    const p = resolveGovernancePrivilege({
      myAddress: '0xignored',
      safeAddress: null,
      captainWearers: null,
      crewWearers: undefined,
      capabilities: snap,
    });
    expect(p.myAddress).toBe('0xsnap');
    expect(p.roleLabel).toBe('governance.roleLabel.noOnChainHat');
    expect(p.squadAdminFull).toBe(true);
  });

  it('labels roles from wearers when no snapshot', () => {
    expect(
      resolveGovernancePrivilege({
        myAddress: null,
        safeAddress: '0xSAFE',
        captainWearers: ['0xsafe'],
        crewWearers: [],
      }).roleLabel,
    ).toBe('governance.roleLabel.noSquadEvmLinked');

    expect(
      resolveGovernancePrivilege({
        myAddress: '0xAAA',
        safeAddress: '0xSAFE',
        captainWearers: ['0xaaa'],
        crewWearers: ['0xaaa'],
      }).roleLabel,
    ).toBe('governance.roleLabel.captainAndCrew');

    expect(
      resolveGovernancePrivilege({
        myAddress: '0xAAA',
        safeAddress: '0xSAFE',
        captainWearers: [],
        crewWearers: ['0xaaa'],
      }).roleLabel,
    ).toBe('governance.roleLabel.crew');

    expect(
      resolveGovernancePrivilege({
        myAddress: '0xAAA',
        safeAddress: '0xSAFE',
        captainWearers: ['0xsafe'],
        crewWearers: [],
      }).roleLabel,
    ).toBe('governance.roleLabel.noHatSafeHoldsCaptain');
  });
});

describe('governance gates', () => {
  const base = resolveGovernancePrivilege({
    myAddress: '0xAAA',
    safeAddress: '0xSAFE',
    captainWearers: ['0xaaa'],
    crewWearers: ['0xaaa'],
  });

  it('uses capability flags when present', () => {
    const denied = {
      ...base,
      capabilities: {
        crewVote: { allowed: false, reason: '' },
        captainVote: { allowed: false, reason: 'Nope' },
        proposeTreasury: { allowed: true, reason: '' },
        executeTreasury: { allowed: false, reason: 'No exec' },
        squadAdminCreateRole: { allowed: true, reason: '' },
      },
    };
    expect(gateRequiresCrew(denied)).toEqual({ enabled: false, reason: 'governance.gate.accessDenied' });
    expect(gateRequiresCaptain(denied)).toEqual({
      enabled: false,
      reason: 'governance.gate.accessDenied',
    });
    expect(gateRequiresCaptainOrCrew(denied).enabled).toBe(true);
    expect(gatePermissionlessSigner(denied)).toEqual({
      enabled: false,
      reason: 'governance.gate.accessDenied',
    });
    expect(gateSquadAdminWrite(denied).enabled).toBe(true);
  });

  it('maps known ACL strings and fails closed on unknown', () => {
    expect(localizeAclReason('Link a squad EVM address to act.')).toBe(
      'governance.gate.linkSquadEvmAddressToAct',
    );
    expect(
      localizeAclReason(
        'No squad EVM address linked for this parent; link a roster key before acting.',
      ),
    ).toBe('governance.gate.linkSquadEvmAddressToAct');
    expect(localizeAclReason('governance.gate.requiresCrew')).toBe('governance.gate.requiresCrew');
    expect(localizeAclReason('Nope')).toBe('governance.gate.accessDenied');
  });

  it('falls back to hat checks without capability flags', () => {
    const noEvm = { ...base, myAddress: '', wearsCaptain: false, wearsCrew: false };
    expect(gateRequiresCrew(noEvm).reason).toBe('governance.gate.linkSquadEvmAddressToAct');
    expect(gateRequiresCaptain(noEvm).reason).toBe('governance.gate.linkSquadEvmAddressToAct');
    expect(gateRequiresCaptainOrCrew(noEvm).reason).toBe('governance.gate.linkSquadEvmAddressToAct');
    expect(gatePermissionlessSigner(noEvm).reason).toBe('governance.gate.linkSquadEvmAddressToSign');

    const crewOnly = { ...base, wearsCaptain: false, wearsCrew: true, captainIsSafe: false };
    expect(gateRequiresCrew(crewOnly).enabled).toBe(true);
    expect(gateRequiresCaptain(crewOnly).reason).toBe('governance.gate.requiresCaptain');
    expect(gateRequiresCaptainOrCrew(crewOnly).enabled).toBe(true);

    const none = { ...base, wearsCaptain: false, wearsCrew: false, captainIsSafe: false };
    expect(gateRequiresCaptainOrCrew(none).reason).toBe('governance.gate.requiresCaptainOrCrew');
    expect(gatePermissionlessSigner(base).enabled).toBe(true);
  });

  it('blocks mutiny-locked quartermaster writes', () => {
    expect(gateBlockedByMutinyMode(base, true).enabled).toBe(false);
    expect(gateBlockedByMutinyMode(base, false).enabled).toBe(true);
    expect(gateBlockedByMutinyMode(base, true, 'governance.gate.rosterFrozenOffboard').reason).toBe(
      'governance.gate.rosterFrozenOffboard',
    );
    expect(gateSquadAdminWrite(base).enabled).toBe(true);
  });
});
