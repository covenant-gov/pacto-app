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
      roleLabel: localizeRoleLabel(snap.roleLabel) || 'governance.roleLabel.noOnChainHat',
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

  let roleLabel = 'governance.roleLabel.noOnChainHat';
  if (!my) roleLabel = 'governance.roleLabel.noSquadEvmLinked';
  else if (wearsCaptain && wearsCrew) roleLabel = 'governance.roleLabel.captainAndCrew';
  else if (wearsCaptain) roleLabel = 'governance.roleLabel.captain';
  else if (wearsCrew) roleLabel = 'governance.roleLabel.crew';
  else if (captainIsSafe) roleLabel = 'governance.roleLabel.noHatSafeHoldsCaptain';

  return { myAddress: my, wearsCaptain, wearsCrew, captainIsSafe, roleLabel };
}

/** Map backend role label strings to i18n keys. Unknown labels are passed through. */
export function localizeRoleLabel(label: string): string {
  switch (label) {
    case 'No on-chain hat':
      return 'governance.roleLabel.noOnChainHat';
    case 'No squad EVM linked':
      return 'governance.roleLabel.noSquadEvmLinked';
    case 'Captain + Crew':
      return 'governance.roleLabel.captainAndCrew';
    case 'Captain':
      return 'governance.roleLabel.captain';
    case 'Crew':
      return 'governance.roleLabel.crew';
    case 'No hat · Safe holds captain':
      return 'governance.roleLabel.noHatSafeHoldsCaptain';
    default:
      return label;
  }
}

export type CtaGate =
  | { enabled: true; reason: '' }
  | { enabled: false; reason: string };

/** Map backend ACL reason strings to i18n keys. Unknown reasons are passed through. */
export function localizeAclReason(reason: string): string {
  switch (reason) {
    case 'Link a squad EVM address to act.':
      return 'governance.gate.linkSquadEvmAddressToAct';
    case 'Link a squad EVM address to sign.':
      return 'governance.gate.linkSquadEvmAddressToSign';
    case 'Requires Crew hat.':
      return 'governance.gate.requiresCrew';
    case 'Captain hat is on the Safe.':
      return 'governance.gate.captainHatOnSafe';
    case 'Requires Captain hat.':
      return 'governance.gate.requiresCaptain';
    case 'Requires Captain or Crew hat.':
      return 'governance.gate.requiresCaptainOrCrew';
    case 'Access denied':
    case 'Access denied.':
      return 'governance.gate.accessDenied';
    default:
      return reason;
  }
}

function gateFromCapability(p: GovernancePrivilege, key: GovCapabilityKey): CtaGate | null {
  const flag = p.capabilities?.[key];
  if (!flag) return null;
  if (flag.allowed) return { enabled: true, reason: '' };
  return { enabled: false, reason: localizeAclReason(flag.reason || 'governance.gate.accessDenied') };
}

export function gateRequiresCrew(p: GovernancePrivilege): CtaGate {
  return (
    gateFromCapability(p, 'crewVote') ??
    (() => {
      if (!p.myAddress) return { enabled: false, reason: 'governance.gate.linkSquadEvmAddressToAct' };
      if (!p.wearsCrew) return { enabled: false, reason: 'governance.gate.requiresCrew' };
      return { enabled: true, reason: '' };
    })()
  );
}

export function gateRequiresCaptain(p: GovernancePrivilege): CtaGate {
  return (
    gateFromCapability(p, 'captainVote') ??
    (() => {
      if (!p.myAddress) return { enabled: false, reason: 'governance.gate.linkSquadEvmAddressToAct' };
      if (p.captainIsSafe && !p.wearsCaptain) {
        return { enabled: false, reason: 'governance.gate.captainHatOnSafe' };
      }
      if (!p.wearsCaptain) return { enabled: false, reason: 'governance.gate.requiresCaptain' };
      return { enabled: true, reason: '' };
    })()
  );
}

export function gateRequiresCaptainOrCrew(p: GovernancePrivilege): CtaGate {
  return (
    gateFromCapability(p, 'proposeTreasury') ??
    gateFromCapability(p, 'mutateTrackedTokens') ??
    (() => {
      if (!p.myAddress) return { enabled: false, reason: 'governance.gate.linkSquadEvmAddressToAct' };
      if (p.wearsCaptain || p.wearsCrew) return { enabled: true, reason: '' };
      return { enabled: false, reason: 'governance.gate.requiresCaptainOrCrew' };
    })()
  );
}

/** Permissionless once thresholds are met — still needs a linked EVM for signing. */
export function gatePermissionlessSigner(p: GovernancePrivilege): CtaGate {
  return (
    gateFromCapability(p, 'executeTreasury') ??
    (() => {
      if (!p.myAddress) return { enabled: false, reason: 'governance.gate.linkSquadEvmAddressToSign' };
      return { enabled: true, reason: '' };
    })()
  );
}

/** Timelocked crew execute — ACL `quartermasterExecute` or any linked squad EVM. */
export function gateQuartermasterExecute(p: GovernancePrivilege, mutinyMode: boolean): CtaGate {
  if (mutinyMode) {
    return { enabled: false, reason: 'governance.gate.quartermasterLocked' };
  }
  return (
    gateFromCapability(p, 'quartermasterExecute') ??
    (() => {
      if (!p.myAddress) return { enabled: false, reason: 'governance.gate.linkSquadEvmAddressToSign' };
      return { enabled: true, reason: '' };
    })()
  );
}

export function gateBlockedByMutinyMode(p: GovernancePrivilege, mutinyMode: boolean): CtaGate {
  if (mutinyMode) {
    return { enabled: false, reason: 'governance.gate.quartermasterLocked' };
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
