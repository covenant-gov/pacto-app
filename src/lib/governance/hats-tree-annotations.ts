import type { HatTreeNodeDto, MemberHatAssignmentDto, NavePirataDeploymentDto } from './api';
import {
  hatChecksFromNaveDeployment,
  type PactoGovProviderPayloadV1,
} from './pacto-gov-payload';

export function shortEvmAddress(addr: string): string {
  const a = addr.trim();
  if (a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Pacto Gov module addresses that may wear role hats (not just squad roster EOAs). */
export function protocolWearerCandidateAddresses(
  payload: PactoGovProviderPayloadV1 | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [
    payload?.safe,
    payload?.treasuryAuthority,
    payload?.mutinyModule,
    payload?.quartermaster,
    payload?.squadAdminProxy,
  ]) {
    const a = raw?.trim();
    if (!a || !/^0x[a-fA-F0-9]{40}$/.test(a)) continue;
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/** Friendly labels for protocol module wearers on the Roles tree. */
export function protocolWearerLabelByAddress(
  payload: PactoGovProviderPayloadV1 | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (raw: string | undefined, label: string) => {
    const a = raw?.trim();
    if (!a || !/^0x[a-fA-F0-9]{40}$/.test(a)) return;
    out[a.toLowerCase()] = label;
  };
  put(payload?.safe, 'Treasury Safe');
  put(payload?.treasuryAuthority, 'Treasury Authority');
  put(payload?.mutinyModule, 'Mutiny module');
  put(payload?.quartermaster, 'Quartermaster');
  put(payload?.squadAdminProxy, 'Squad Admin');
  return out;
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

/** Invert `squadMemberEvmByNpub` to lowercase EVM address → npub. */
export function npubByEvmAddressFromSquadRoster(
  squadMemberEvmByNpub: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [npub, addr] of Object.entries(squadMemberEvmByNpub)) {
    const trimmed = addr?.trim();
    if (trimmed) out[trimmed.toLowerCase()] = npub;
  }
  return out;
}

export function formatWearerDisplayLabel(
  address: string,
  npubByAddress: Record<string, string>,
  displayNameForNpub: (npub: string) => string,
  knownLabels?: Record<string, string>,
): string {
  const key = address.trim().toLowerCase();
  const npub = npubByAddress[key];
  if (npub) {
    const name = displayNameForNpub(npub)?.trim();
    if (name && name !== 'Unknown') return name;
  }
  const known = knownLabels?.[key]?.trim();
  if (known) return known;
  return shortEvmAddress(address);
}

/** Invert member hat assignments to hat id → wearer addresses (lowercase). */
export function wearerAddressesByHatIdFromAssignments(
  assignments: MemberHatAssignmentDto[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const row of assignments) {
    const addr = row.address?.trim();
    if (!addr) continue;
    const key = addr.toLowerCase();
    for (const hat of row.hats) {
      const id = hat.hatId?.trim();
      if (!id) continue;
      if (!out[id]) out[id] = [];
      if (!out[id].includes(key)) out[id].push(key);
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

export type RolesTreeAnnotationMaps = {
  roleLabelByHatId: Record<string, string>;
  wearerAddressesByHatId: Record<string, string[]>;
};

/** Merge registry role hat ids and member wears into tree annotation maps. */
export function mergeRolesTreeAnnotationMaps(
  deployment: Pick<
    NavePirataDeploymentDto,
    | 'captainHatId'
    | 'crewHatId'
    | 'squadAdminHatId'
    | 'mutinyRoleHatId'
    | 'quartermasterRoleHatId'
    | 'treasuryAuthorityRoleHatId'
  >,
  assignments: MemberHatAssignmentDto[],
  topHatId?: string,
): RolesTreeAnnotationMaps {
  const roleLabelByHatId = roleLabelByHatIdFromNaveDeployment(deployment);
  const top = topHatId?.trim();
  if (top && !roleLabelByHatId[top]) {
    roleLabelByHatId[top] = 'Top hat';
  }
  return {
    roleLabelByHatId,
    wearerAddressesByHatId: wearerAddressesByHatIdFromAssignments(assignments),
  };
}

/** Role hat checks plus top hat so tree supply rows can resolve wearers. */
export function hatChecksForRolesTree(
  deployment: Parameters<typeof hatChecksFromNaveDeployment>[0],
  topHatId?: string,
): { hatId: string; label: string }[] {
  const checks = hatChecksFromNaveDeployment(deployment);
  const top = topHatId?.trim();
  if (top && !checks.some((c) => c.hatId.trim() === top)) {
    checks.unshift({ hatId: top, label: 'Top hat' });
  }
  return checks;
}

export type AnnotatedRolesTreeNode = {
  hatId: string;
  roleLabel: string;
  wearerAddresses: string[];
};

/** Collect hat nodes that have a Nave Pirata label and/or known wearers. */
export function collectAnnotatedRolesTreeNodes(
  tree: HatTreeNodeDto,
  maps: RolesTreeAnnotationMaps,
): AnnotatedRolesTreeNode[] {
  const out: AnnotatedRolesTreeNode[] = [];
  const walk = (node: HatTreeNodeDto) => {
    const roleLabel = maps.roleLabelByHatId[node.hatId] ?? '';
    const wearerAddresses = maps.wearerAddressesByHatId[node.hatId] ?? [];
    if (roleLabel || wearerAddresses.length > 0) {
      out.push({ hatId: node.hatId, roleLabel, wearerAddresses });
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return out;
}
