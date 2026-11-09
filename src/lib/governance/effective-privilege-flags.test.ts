import { describe, expect, it } from 'vitest';
import {
  hasPrivilegeAction,
  resolveEffectivePrivilegeFlags,
} from './effective-privilege-flags';
import {
  FLAG_BROADCAST,
  FLAG_CREATE_CHANNEL,
  FLAG_INVITE_ACCEPT,
  encodePrivilegeRoleId,
} from './privilege-role-id';

describe('resolveEffectivePrivilegeFlags', () => {
  it('FULL grants all when not paused', () => {
    const f = resolveEffectivePrivilegeFlags({
      fullPermission: true,
      paused: false,
      enabledRoleIds: [],
    });
    expect(f.inviteAccept).toBe(true);
    expect(f.createChannel).toBe(true);
    expect(f.broadcast).toBe(true);
    expect(f.manageNetwork).toBe(true);
    expect(f.firstMate).toBe(true);
    expect(f.fullPermission).toBe(true);
    expect(hasPrivilegeAction(f, 'broadcast')).toBe(true);
  });

  it('PAUSE overrides FULL', () => {
    const f = resolveEffectivePrivilegeFlags({
      fullPermission: true,
      paused: true,
      enabledRoleIds: [
        encodePrivilegeRoleId({ name: 'Mod', flags: FLAG_INVITE_ACCEPT | FLAG_CREATE_CHANNEL }),
      ],
    });
    expect(f.inviteAccept).toBe(false);
    expect(f.knownFlags).toBe(0);
    expect(f.paused).toBe(true);
    expect(hasPrivilegeAction(f, 'inviteAccept')).toBe(false);
  });

  it('ORs known flags across roles', () => {
    const a = encodePrivilegeRoleId({ name: 'A', flags: FLAG_INVITE_ACCEPT });
    const b = encodePrivilegeRoleId({ name: 'B', flags: FLAG_BROADCAST });
    const f = resolveEffectivePrivilegeFlags({
      fullPermission: false,
      paused: false,
      enabledRoleIds: [a, b],
    });
    expect(f.inviteAccept).toBe(true);
    expect(f.broadcast).toBe(true);
    expect(f.createChannel).toBe(false);
    expect(f.knownFlags).toBe(FLAG_INVITE_ACCEPT | FLAG_BROADCAST);
  });

  it('ignores unknown version and reserved-nonzero ids', () => {
    const good = encodePrivilegeRoleId({ name: 'X', flags: FLAG_CREATE_CHANNEL });
    const badVersion = '0x5800000000000000000000000000000000000000000000000000000000020001';
    const badReserved = '0x58000000000000000000000000000000000000000000000000000000ab010001';
    const f = resolveEffectivePrivilegeFlags({
      fullPermission: false,
      paused: false,
      enabledRoleIds: [good, badVersion, badReserved],
    });
    expect(f.knownFlags).toBe(FLAG_CREATE_CHANNEL);
    expect(f.createChannel).toBe(true);
    expect(f.inviteAccept).toBe(false);
  });

  it('bit 5 does not grant unknown powers', () => {
    const withBit5 = '0x5800000000000000000000000000000000000000000000000000000000010021';
    const f = resolveEffectivePrivilegeFlags({
      fullPermission: false,
      paused: false,
      enabledRoleIds: [withBit5],
    });
    expect(f.inviteAccept).toBe(true);
    expect(f.knownFlags).toBe(FLAG_INVITE_ACCEPT);
  });
});
