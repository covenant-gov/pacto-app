/** Visible privilege gating for Pacto Gov CTAs — show buttons, disable with reason. */

export type GovernanceHatRole = 'captain' | 'crew' | 'none';

export interface GovernancePrivilege {
  /** Lowercased squad EVM for the current user, or empty. */
  myAddress: string;
  wearsCaptain: boolean;
  wearsCrew: boolean;
  /** Captain hat sits on the Safe (pause-captain path). */
  captainIsSafe: boolean;
  roleLabel: string;
}

export function resolveGovernancePrivilege(params: {
  myAddress: string | null | undefined;
  safeAddress: string | null | undefined;
  captainWearers: string[] | null | undefined;
  crewWearers: string[] | null | undefined;
}): GovernancePrivilege {
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

export function gateRequiresCrew(p: GovernancePrivilege): CtaGate {
  if (!p.myAddress) return { enabled: false, reason: 'Link a squad EVM address to act.' };
  if (!p.wearsCrew) return { enabled: false, reason: 'Requires Crew hat.' };
  return { enabled: true, reason: '' };
}

export function gateRequiresCaptain(p: GovernancePrivilege): CtaGate {
  if (!p.myAddress) return { enabled: false, reason: 'Link a squad EVM address to act.' };
  if (p.captainIsSafe && !p.wearsCaptain) {
    return { enabled: false, reason: 'Captain hat is on the Safe.' };
  }
  if (!p.wearsCaptain) return { enabled: false, reason: 'Requires Captain hat.' };
  return { enabled: true, reason: '' };
}

export function gateRequiresCaptainOrCrew(p: GovernancePrivilege): CtaGate {
  if (!p.myAddress) return { enabled: false, reason: 'Link a squad EVM address to act.' };
  if (p.wearsCaptain || p.wearsCrew) return { enabled: true, reason: '' };
  return { enabled: false, reason: 'Requires Captain or Crew hat.' };
}

/** Permissionless once thresholds are met — still needs a linked EVM for signing. */
export function gatePermissionlessSigner(p: GovernancePrivilege): CtaGate {
  if (!p.myAddress) return { enabled: false, reason: 'Link a squad EVM address to sign.' };
  return { enabled: true, reason: '' };
}

export function gateBlockedByMutinyMode(p: GovernancePrivilege, mutinyMode: boolean): CtaGate {
  if (mutinyMode) {
    return { enabled: false, reason: 'Quartermaster locked while mutiny is active.' };
  }
  return gateRequiresCaptain(p);
}
