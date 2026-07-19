/**
 * Visible privilege gating for Pacto Gov CTAs — show buttons, disable with reason.
 * Hat / ACL state never hides the governance dashboard; hat-less members still see peer-synced state.
 */

import type { SquadCapabilitiesDto } from './api';

export type GovernanceHatRole = 'captain' | 'crew' | 'none';

export type GovCapabilityKey =
  | 'proposeTreasury'
  | 'crewVote'
  | 'captainVote'
  | 'executeTreasury'
  | 'startMutiny'
  | 'castMutinyVote'
  | 'executeMutiny'
  | 'captainResign'
  | 'quartermasterMutateCrew'
  | 'quartermasterExecute'
  | 'mutateTrackedTokens'
  | 'squadAdminCreateRole'
  | 'squadAdminEnableExecutor'
  | 'squadAdminEnableFull';

export interface GovernancePrivilege {
  /** Lowercased squad EVM for the current user, or empty. */
  myAddress: string;
  wearsCaptain: boolean;
  wearsCrew: boolean;
  /** Captain hat sits on the Safe (pause-captain path). */
  captainIsSafe: boolean;
  roleLabel: string;
  /** Optional ACL snapshot from `get_squad_capabilities`. */
  capabilities?: SquadCapabilitiesDto['capabilities'] | null;
  squadAdminFull?: boolean;
  squadAdminPaused?: boolean;
}

export function resolveGovernancePrivilege(params: {
  myAddress: string | null | undefined;
  safeAddress: string | null | undefined;
  captainWearers: string[] | null | undefined;
  crewWearers: string[] | null | undefined;
  capabilities?: SquadCapabilitiesDto | null;
}): GovernancePrivilege {
  const snap = params.capabilities ?? null;
  if (snap) {
    return {
      myAddress: snap.rosterAddress?.trim().toLowerCase() ?? '',
      wearsCaptain: snap.wearsCaptain,
      wearsCrew: snap.wearsCrew,
      captainIsSafe: snap.captainIsSafe,
      roleLabel: snap.roleLabel || 'No on-chain hat',
      capabilities: snap.capabilities,
      squadAdminFull: snap.squadAdminFull,
      squadAdminPaused: snap.squadAdminPaused,
    };
  }

  const my = params.myAddress?.trim().toLowerCase() ?? '';
  const safe = params.safeAddress?.trim().toLowerCase() ?? '';
  const captains = (params.captainWearers ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const crew = (params.crewWearers ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean);

  const captainIsSafe = !!safe && captains.includes(safe);
  const wearsCaptain = !!my && captains.includes(my);
  const wearsCrew = !!my && crew.includes(my);

  let roleLabel = 'No on-chain hat';
  if (!my) roleLabel = 'No squad EVM linked';
  else if (wearsCaptain && wearsCrew) roleLabel = 'Captain + Crew';
  else if (wearsCaptain) roleLabel = 'Captain';
  else if (wearsCrew) roleLabel = 'Crew';
  else if (captainIsSafe) roleLabel = 'No hat · Safe holds captain';

  return { myAddress: my, wearsCaptain, wearsCrew, captainIsSafe, roleLabel };
}

export type CtaGate =
  | { enabled: true; reason: '' }
  | { enabled: false; reason: string };

function gateFromCapability(p: GovernancePrivilege, key: GovCapabilityKey): CtaGate | null {
  const flag = p.capabilities?.[key];
  if (!flag) return null;
  if (flag.allowed) return { enabled: true, reason: '' };
  return { enabled: false, reason: flag.reason || 'Access denied' };
}

export function gateRequiresCrew(p: GovernancePrivilege): CtaGate {
  return (
    gateFromCapability(p, 'crewVote') ??
    (() => {
      if (!p.myAddress) return { enabled: false, reason: 'Link a squad EVM address to act.' };
      if (!p.wearsCrew) return { enabled: false, reason: 'Requires Crew hat.' };
      return { enabled: true, reason: '' };
    })()
  );
}

export function gateRequiresCaptain(p: GovernancePrivilege): CtaGate {
  return (
    gateFromCapability(p, 'captainVote') ??
    (() => {
      if (!p.myAddress) return { enabled: false, reason: 'Link a squad EVM address to act.' };
      if (p.captainIsSafe && !p.wearsCaptain) {
        return { enabled: false, reason: 'Captain hat is on the Safe.' };
      }
      if (!p.wearsCaptain) return { enabled: false, reason: 'Requires Captain hat.' };
      return { enabled: true, reason: '' };
    })()
  );
}

export function gateRequiresCaptainOrCrew(p: GovernancePrivilege): CtaGate {
  return (
    gateFromCapability(p, 'proposeTreasury') ??
    gateFromCapability(p, 'mutateTrackedTokens') ??
    (() => {
      if (!p.myAddress) return { enabled: false, reason: 'Link a squad EVM address to act.' };
      if (p.wearsCaptain || p.wearsCrew) return { enabled: true, reason: '' };
      return { enabled: false, reason: 'Requires Captain or Crew hat.' };
    })()
  );
}

/** Permissionless once thresholds are met — still needs a linked EVM for signing. */
export function gatePermissionlessSigner(p: GovernancePrivilege): CtaGate {
  return (
    gateFromCapability(p, 'executeTreasury') ??
    (() => {
      if (!p.myAddress) return { enabled: false, reason: 'Link a squad EVM address to sign.' };
      return { enabled: true, reason: '' };
    })()
  );
}

export function gateBlockedByMutinyMode(p: GovernancePrivilege, mutinyMode: boolean): CtaGate {
  if (mutinyMode) {
    return { enabled: false, reason: 'Quartermaster locked while mutiny is active.' };
  }
  return (
    gateFromCapability(p, 'quartermasterMutateCrew') ?? gateRequiresCaptain(p)
  );
}

export function gateSquadAdminWrite(p: GovernancePrivilege): CtaGate {
  return (
    gateFromCapability(p, 'squadAdminCreateRole') ?? gateRequiresCaptain(p)
  );
}
