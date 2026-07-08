import type { MemberHatAssignmentDto, NavePirataDeploymentDto } from './api';
import { hatChecksFromNaveDeployment } from './pacto-gov-payload';

export function shortEvmAddress(addr: string): string {
  const a = addr.trim();
  if (a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Nave Pirata role label keyed by on-chain hat id. */
export function roleLabelByHatIdFromNaveDeployment(
  deployment: Pick<
    NavePirataDeploymentDto,
    | 'captainHatId'
    | 'crewHatId'
    | 'squadAdminHatId'
    | 'mutinyRoleHatId'
    | 'quartermasterRoleHatId'
    | 'treasuryAuthorityRoleHatId'
  >,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const { hatId, label } of hatChecksFromNaveDeployment(deployment)) {
    const id = hatId.trim();
    if (id) map[id] = label;
  }
  return map;
}

/** Invert member hat assignments to hat id → short wearer addresses. */
export function wearersByHatIdFromAssignments(
  assignments: MemberHatAssignmentDto[],
  formatAddress: (addr: string) => string = shortEvmAddress,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const row of assignments) {
    const addr = row.address?.trim();
    if (!addr) continue;
    const display = formatAddress(addr);
    for (const hat of row.hats) {
      const id = hat.hatId?.trim();
      if (!id) continue;
      if (!out[id]) out[id] = [];
      if (!out[id].includes(display)) out[id].push(display);
    }
  }
  return out;
}

/** Settings column: address → comma-separated role labels. */
export function memberHatByAddressFromAssignments(
  assignments: MemberHatAssignmentDto[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of assignments) {
    if (row.hats.length > 0) {
      map[row.address.toLowerCase()] = row.hats.map((h) => h.label).join(', ');
    }
  }
  return map;
}
