/** Client-side SquadAdmin privilege role `bytes32` packing (pacto-gov SquadAdmin.md v1). */

export const PRIVILEGE_ROLE_ENCODING_VERSION = 1;
export const PRIVILEGE_ROLE_NAME_MAX_BYTES = 28;

export const FLAG_INVITE_ACCEPT = 1 << 0;
export const FLAG_CREATE_CHANNEL = 1 << 1;
export const FLAG_BROADCAST = 1 << 2;
export const FLAG_MANAGE_NETWORK = 1 << 3;
export const FLAG_FIRST_MATE = 1 << 4;

/** Known action bits in v1 (0..4). Reserved bits 5..15 grant nothing. */
export const PRIVILEGE_KNOWN_ACTION_MASK =
  FLAG_INVITE_ACCEPT |
  FLAG_CREATE_CHANNEL |
  FLAG_BROADCAST |
  FLAG_MANAGE_NETWORK |
  FLAG_FIRST_MATE;

export const FULL_PERMISSION_ROLE_ID =
  '0x46554c4c00000000000000000000000000000000000000000000000000000000';
export const PAUSE_PERMISSION_ROLE_ID =
  '0x5041555345000000000000000000000000000000000000000000000000000000';

export type PrivilegeRoleIdDecode =
  | {
      ok: true;
      version: typeof PRIVILEGE_ROLE_ENCODING_VERSION;
      flags: number;
      /** Known action bits only (0..4). */
      knownFlags: number;
      name: string;
    }
  | { ok: false; reason: 'invalid_hex' | 'unknown_version' | 'reserved_nonzero' };

function assertHexRoleId(raw: string): Uint8Array | null {
  const t = raw.trim();
  const h = t.startsWith('0x') || t.startsWith('0X') ? t.slice(2) : t;
  if (h.length !== 64 || !/^[0-9a-fA-F]+$/.test(h)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '0x';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function nameToBytes(name: string): Uint8Array {
  const enc = new TextEncoder().encode(name);
  if (enc.length > PRIVILEGE_ROLE_NAME_MAX_BYTES) {
    throw new Error(`role name must be at most ${PRIVILEGE_ROLE_NAME_MAX_BYTES} bytes`);
  }
  const out = new Uint8Array(PRIVILEGE_ROLE_NAME_MAX_BYTES);
  out.set(enc);
  return out;
}

function nameFromBytes(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

/**
 * Pack flags + display name into a v1 role id.
 * `flags` may only set known bits 0..4; reserved bits must be 0.
 */
export function encodePrivilegeRoleId(params: { name: string; flags: number }): string {
  const flags = params.flags >>> 0;
  if ((flags & ~PRIVILEGE_KNOWN_ACTION_MASK) !== 0) {
    throw new Error('unknown/reserved privilege flag bits must be 0 when encoding v1');
  }
  if (flags > 0xffff) {
    throw new Error('flags must fit in 16 bits');
  }
  const nameBytes = nameToBytes(params.name);
  const out = new Uint8Array(32);
  out.set(nameBytes, 0);
  out[28] = 0;
  out[29] = PRIVILEGE_ROLE_ENCODING_VERSION;
  out[30] = (flags >> 8) & 0xff;
  out[31] = flags & 0xff;
  return bytesToHex(out);
}

/** Decode a packed role id. Fail-closed on bad hex, unknown version, or reserved ≠ 0. */
export function decodePrivilegeRoleId(roleId: string): PrivilegeRoleIdDecode {
  const bytes = assertHexRoleId(roleId);
  if (!bytes) return { ok: false, reason: 'invalid_hex' };
  const reserved = bytes[28];
  const version = bytes[29];
  const flags = (bytes[30] << 8) | bytes[31];
  if (version !== PRIVILEGE_ROLE_ENCODING_VERSION) {
    return { ok: false, reason: 'unknown_version' };
  }
  if (reserved !== 0) {
    return { ok: false, reason: 'reserved_nonzero' };
  }
  return {
    ok: true,
    version: PRIVILEGE_ROLE_ENCODING_VERSION,
    flags,
    knownFlags: flags & PRIVILEGE_KNOWN_ACTION_MASK,
    name: nameFromBytes(bytes.subarray(0, PRIVILEGE_ROLE_NAME_MAX_BYTES)),
  };
}

export function isPrivilegeSentinelRoleId(roleId: string): boolean {
  const t = roleId.trim().toLowerCase();
  return t === FULL_PERMISSION_ROLE_ID || t === PAUSE_PERMISSION_ROLE_ID;
}

export type PrivilegeFlagChip = {
  bit: number;
  flag: number;
  /** i18n key under governance.privileges.flag.* */
  key:
    | 'inviteAccept'
    | 'createChannel'
    | 'broadcast'
    | 'manageNetwork'
    | 'firstMate';
};

export const PRIVILEGE_FLAG_CHIPS: PrivilegeFlagChip[] = [
  { bit: 0, flag: FLAG_INVITE_ACCEPT, key: 'inviteAccept' },
  { bit: 1, flag: FLAG_CREATE_CHANNEL, key: 'createChannel' },
  { bit: 2, flag: FLAG_BROADCAST, key: 'broadcast' },
  { bit: 3, flag: FLAG_MANAGE_NETWORK, key: 'manageNetwork' },
  { bit: 4, flag: FLAG_FIRST_MATE, key: 'firstMate' },
];

/** Catalog row summary for UI lists. */
export function describePrivilegeCatalogRole(roleId: string): {
  roleId: string;
  ok: boolean;
  name: string;
  knownFlags: number;
  hasFirstMate: boolean;
} {
  const decoded = decodePrivilegeRoleId(roleId);
  if (!decoded.ok) {
    return {
      roleId,
      ok: false,
      name: roleId.slice(0, 10) + '…',
      knownFlags: 0,
      hasFirstMate: false,
    };
  }
  return {
    roleId,
    ok: true,
    name: decoded.name.trim() || '—',
    knownFlags: decoded.knownFlags,
    hasFirstMate: (decoded.knownFlags & FLAG_FIRST_MATE) !== 0,
  };
}
