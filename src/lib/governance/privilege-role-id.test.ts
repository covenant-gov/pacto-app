import { describe, expect, it } from 'vitest';
import {
  FLAG_BROADCAST,
  FLAG_CREATE_CHANNEL,
  FLAG_FIRST_MATE,
  FLAG_INVITE_ACCEPT,
  FLAG_MANAGE_NETWORK,
  decodePrivilegeRoleId,
  describePrivilegeCatalogRole,
  encodePrivilegeRoleId,
} from './privilege-role-id';

/** Hex vectors from pacto-gov docs/SquadAdmin.md (PR #58). */
const ROUND_TRIPS: Array<{
  label: string;
  flags: number;
  name: string;
  hex: string;
}> = [
  {
    label: 'Invite + Moderator',
    flags: FLAG_INVITE_ACCEPT,
    name: 'Moderator',
    hex: '0x4d6f64657261746f720000000000000000000000000000000000000000010001',
  },
  {
    label: 'Invite|Create + Mod',
    flags: FLAG_INVITE_ACCEPT | FLAG_CREATE_CHANNEL,
    name: 'Mod',
    hex: '0x4d6f640000000000000000000000000000000000000000000000000000010003',
  },
  {
    label: 'Broadcast + empty name',
    flags: FLAG_BROADCAST,
    name: '',
    hex: '0x0000000000000000000000000000000000000000000000000000000000010004',
  },
  {
    label: 'Invite + 28-byte name',
    flags: FLAG_INVITE_ACCEPT,
    name: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ12',
    hex: '0x4142434445464748494a4b4c4d4e4f505152535455565758595a313200010001',
  },
  {
    label: 'Invite|Create|Broadcast + Mate',
    flags: FLAG_INVITE_ACCEPT | FLAG_CREATE_CHANNEL | FLAG_BROADCAST,
    name: 'Mate',
    hex: '0x4d61746500000000000000000000000000000000000000000000000000010007',
  },
  {
    label: 'All known flags + Ops',
    flags:
      FLAG_INVITE_ACCEPT |
      FLAG_CREATE_CHANNEL |
      FLAG_BROADCAST |
      FLAG_MANAGE_NETWORK |
      FLAG_FIRST_MATE,
    name: 'Ops',
    hex: '0x4f7073000000000000000000000000000000000000000000000000000001001f',
  },
  {
    label: 'Broadcast + Alpha',
    flags: FLAG_BROADCAST,
    name: 'Alpha',
    hex: '0x416c706861000000000000000000000000000000000000000000000000010004',
  },
  {
    label: 'Broadcast + Beta',
    flags: FLAG_BROADCAST,
    name: 'Beta',
    hex: '0x4265746100000000000000000000000000000000000000000000000000010004',
  },
];

describe('privilege-role-id encode/decode (gov PR #58 vectors)', () => {
  for (const row of ROUND_TRIPS) {
    it(`round-trips ${row.label}`, () => {
      expect(encodePrivilegeRoleId({ name: row.name, flags: row.flags })).toBe(row.hex);
      const decoded = decodePrivilegeRoleId(row.hex);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.flags).toBe(row.flags);
      expect(decoded.knownFlags).toBe(row.flags);
      expect(decoded.name).toBe(row.name);
      expect(decoded.version).toBe(1);
    });
  }

  it('same flags different names are distinct ids', () => {
    const alpha = encodePrivilegeRoleId({ name: 'Alpha', flags: FLAG_BROADCAST });
    const beta = encodePrivilegeRoleId({ name: 'Beta', flags: FLAG_BROADCAST });
    expect(alpha).not.toBe(beta);
  });

  it('fail-closed: version 0', () => {
    const hex = '0x5800000000000000000000000000000000000000000000000000000000000001';
    expect(decodePrivilegeRoleId(hex)).toEqual({ ok: false, reason: 'unknown_version' });
  });

  it('fail-closed: version 2', () => {
    const hex = '0x5800000000000000000000000000000000000000000000000000000000020001';
    expect(decodePrivilegeRoleId(hex)).toEqual({ ok: false, reason: 'unknown_version' });
  });

  it('fail-closed: reserved nonzero', () => {
    const hex = '0x58000000000000000000000000000000000000000000000000000000ab010001';
    expect(decodePrivilegeRoleId(hex)).toEqual({ ok: false, reason: 'reserved_nonzero' });
  });

  it('bit 5 set: grants known bit 0 only', () => {
    const hex = '0x5800000000000000000000000000000000000000000000000000000000010021';
    const decoded = decodePrivilegeRoleId(hex);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.flags).toBe(0x0021);
    expect(decoded.knownFlags).toBe(FLAG_INVITE_ACCEPT);
    expect(decoded.name).toBe('X');
  });

  it('encode rejects reserved flag bits', () => {
    expect(() => encodePrivilegeRoleId({ name: 'X', flags: 1 << 5 })).toThrow(/reserved/i);
  });

  it('encode rejects overlong name', () => {
    expect(() =>
      encodePrivilegeRoleId({ name: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123', flags: 0 }),
    ).toThrow(/28/);
  });

  it('describePrivilegeCatalogRole surfaces name and first-mate bit', () => {
    const id = encodePrivilegeRoleId({
      name: 'Ops',
      flags: FLAG_INVITE_ACCEPT | FLAG_FIRST_MATE,
    });
    const row = describePrivilegeCatalogRole(id);
    expect(row.ok).toBe(true);
    expect(row.name).toBe('Ops');
    expect(row.hasFirstMate).toBe(true);
  });
});
