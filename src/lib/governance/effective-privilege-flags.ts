import {
  FLAG_BROADCAST,
  FLAG_CREATE_CHANNEL,
  FLAG_FIRST_MATE,
  FLAG_INVITE_ACCEPT,
  FLAG_MANAGE_NETWORK,
  PRIVILEGE_KNOWN_ACTION_MASK,
  decodePrivilegeRoleId,
} from './privilege-role-id';

export type EffectivePrivilegeFlags = {
  inviteAccept: boolean;
  createChannel: boolean;
  broadcast: boolean;
  manageNetwork: boolean;
  firstMate: boolean;
  /** Known action bits OR'd (0 when paused). */
  knownFlags: number;
  fullPermission: boolean;
  paused: boolean;
};

const ALL_KNOWN: EffectivePrivilegeFlags = {
  inviteAccept: true,
  createChannel: true,
  broadcast: true,
  manageNetwork: true,
  firstMate: true,
  knownFlags: PRIVILEGE_KNOWN_ACTION_MASK,
  fullPermission: true,
  paused: false,
};

function fromKnownFlags(
  knownFlags: number,
  fullPermission: boolean,
  paused: boolean,
): EffectivePrivilegeFlags {
  return {
    inviteAccept: (knownFlags & FLAG_INVITE_ACCEPT) !== 0,
    createChannel: (knownFlags & FLAG_CREATE_CHANNEL) !== 0,
    broadcast: (knownFlags & FLAG_BROADCAST) !== 0,
    manageNetwork: (knownFlags & FLAG_MANAGE_NETWORK) !== 0,
    firstMate: (knownFlags & FLAG_FIRST_MATE) !== 0,
    knownFlags,
    fullPermission,
    paused,
  };
}

/**
 * Effective actions from FULL/PAUSE + catalog role ids the executor holds.
 * Unknown encoding versions / reserved-nonzero ids contribute nothing.
 */
export function resolveEffectivePrivilegeFlags(params: {
  fullPermission: boolean;
  paused: boolean;
  /** Hex role ids with `hasExecutorRole` true (catalog entries). */
  enabledRoleIds: string[];
}): EffectivePrivilegeFlags {
  if (params.paused) {
    return fromKnownFlags(0, params.fullPermission, true);
  }
  if (params.fullPermission) {
    return { ...ALL_KNOWN };
  }
  let known = 0;
  for (const id of params.enabledRoleIds) {
    const decoded = decodePrivilegeRoleId(id);
    if (!decoded.ok) continue;
    known |= decoded.knownFlags;
  }
  return fromKnownFlags(known, false, false);
}

export function hasPrivilegeAction(
  flags: EffectivePrivilegeFlags,
  action:
    | 'inviteAccept'
    | 'createChannel'
    | 'broadcast'
    | 'manageNetwork'
    | 'firstMate',
): boolean {
  if (flags.paused) return false;
  return flags[action];
}
