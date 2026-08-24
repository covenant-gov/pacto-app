import { invoke } from '@tauri-apps/api/core';
import { getMlsGroupMembers } from '../api/nostr';
import type {
  HatTreeNodeDto,
  QuartermasterPendingActionDto,
  TreasuryProposalDto,
} from '../governance/api';
import {
  getHatsTree,
  getHatWearersForIds,
  getMemberHatWearers,
  getNavePirataDeployment,
  getWarGameDeployment,
  getSquadAdminExecutorRoles,
  listQuartermasterPending,
  listTreasuryProposals,
  treasuryProposalHasVoted,
} from '../governance/api';
import {
  hatChecksForRolesTree,
  memberHatByAddressFromAssignments,
  mergeRolesTreeAnnotationMaps,
} from '../governance/hats-tree-annotations';
import {
  formatSquadAdminExecutorRoles,
  hatChecksFromNaveDeployment,
} from '../governance/pacto-gov-payload';
import { isTreasuryProposalActive } from '../governance/treasury-proposal-ui';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import {
  healSquadMemberEvmShareIfDiverged,
  listSquadMemberEvmInvokeArgs,
} from '../squad/squad-member-evm-share';
import { withReadPlaneLimit } from '../evm/read-plane-limiter';

import { parseSupportedChainId, type SupportedChainId } from '../wallet/chains';

/** True when an async dashboard loader finished for a superseded cache key. */
export function isSupersededLoaderKey(activeKey: string, capturedKey: string): boolean {
  return activeKey !== capturedKey;
}

type SquadMemberEvmRow = { memberNpub: string; evmAddress: string; updatedAtMs: number };

async function listSquadMemberEvmMap(
  parentId: string,
  announcementsGroupId: string | null,
): Promise<Record<string, string>> {
  const q = listSquadMemberEvmInvokeArgs(parentId, announcementsGroupId);
  if (!q.parentId) return {};
  const rows = await invoke<SquadMemberEvmRow[]>('list_squad_member_evm', q);
  const m: Record<string, string> = {};
  for (const r of rows) m[r.memberNpub] = r.evmAddress;
  return m;
}

export async function fetchSquadMemberEvmByNpub(
  parentId: string | undefined,
  announcementsGroupId: string | null,
  myNpub?: string | null,
): Promise<Record<string, string>> {
  if (!parentId && !announcementsGroupId) return {};
  try {
    const q = listSquadMemberEvmInvokeArgs(parentId ?? '', announcementsGroupId);
    if (!q.parentId) return {};
    let m = await listSquadMemberEvmMap(parentId ?? '', announcementsGroupId);
    if (myNpub?.trim()) {
      const healed = await healSquadMemberEvmShareIfDiverged(
        q.parentId,
        m,
        myNpub,
        q.altParentId,
      );
      if (healed) {
        m = await listSquadMemberEvmMap(parentId ?? '', announcementsGroupId);
      }
    }
    return m;
  } catch {
    return {};
  }
}

export async function fetchDashboardChannelMembers(groupId: string | null): Promise<string[]> {
  if (!groupId) return [];
  try {
    const result = await getMlsGroupMembers(groupId);
    return (result.members ?? []) as string[];
  } catch {
    return [];
  }
}

export async function fetchTreasuryProposalVoteMap(params: {
  network: SupportedChainId;
  treasuryAuthority: string;
  proposals: TreasuryProposalDto[];
  voterAddress: string;
  parentId?: string | null;
}): Promise<Record<string, boolean>> {
  const active = params.proposals.filter((p) => isTreasuryProposalActive(p.status));
  if (active.length === 0) return {};
  const pairs = await Promise.all(
    active.map((p) =>
      withReadPlaneLimit(async () => {
        const voted = await treasuryProposalHasVoted({
          network: params.network,
          treasuryAuthority: params.treasuryAuthority,
          proposalId: p.proposalId,
          voter: params.voterAddress,
          parentId: params.parentId,
        });
        return [p.proposalId, voted] as const;
      }),
    ),
  );
  const map: Record<string, boolean> = {};
  for (const [id, voted] of pairs) map[id] = voted;
  return map;
}

export async function fetchTreasuryProposals(params: {
  network: SupportedChainId;
  treasuryAuthority: string;
  parentId?: string | null;
}): Promise<{ proposals: TreasuryProposalDto[]; error: string }> {
  try {
    const rows = await listTreasuryProposals({
      network: params.network,
      treasuryAuthority: params.treasuryAuthority,
      parentId: params.parentId,
    });
    return {
      proposals: [...rows].sort((a, b) => Number(b.proposalId) - Number(a.proposalId)),
      error: '',
    };
  } catch (e) {
    return {
      proposals: [],
      error: getInvokeErrorMessage(e, 'Could not load treasury proposals.'),
    };
  }
}

export async function fetchQuartermasterPendingActions(params: {
  network: string;
  quartermaster: string;
  parentId: string;
}): Promise<{ pending: QuartermasterPendingActionDto[]; error: string }> {
  try {
    const pending = await listQuartermasterPending({
      network: params.network,
      parentId: params.parentId,
      quartermaster: params.quartermaster,
    });
    return { pending, error: '' };
  } catch (e) {
    return {
      pending: [],
      error: getInvokeErrorMessage(e, 'Could not load pending crew changes.'),
    };
  }
}

export async function fetchHatsTree(params: {
  network: SupportedChainId;
  topHatId: string;
  parentId?: string | null;
}): Promise<{ tree: HatTreeNodeDto | null; error: string }> {
  try {
    const tree = await getHatsTree({
      network: params.network,
      topHatId: params.topHatId,
      parentId: params.parentId,
    });
    return { tree, error: '' };
  } catch (e) {
    return {
      tree: null,
      error: getInvokeErrorMessage(e, 'Could not load Hats tree.'),
    };
  }
}

export async function fetchExecutorRolesByAddress(params: {
  network: SupportedChainId;
  squadAdminProxy: string;
  squadAdminChain: string | null;
  evmAddresses: string[];
  parentId?: string | null;
}): Promise<Record<string, string>> {
  if (params.evmAddresses.length === 0) return {};
  const roleNetwork = parseSupportedChainId(params.squadAdminChain?.trim() || params.network);
  const roleRows = await Promise.all(
    params.evmAddresses.map((addr) =>
      withReadPlaneLimit(async () => {
        const roles = await getSquadAdminExecutorRoles({
          network: roleNetwork,
          squadAdminProxy: params.squadAdminProxy,
          executorAddress: addr,
          parentId: params.parentId,
        });
        return {
          address: addr.toLowerCase(),
          label: formatSquadAdminExecutorRoles(roles),
        };
      }),
    ),
  );
  const roleMap: Record<string, string> = {};
  for (const row of roleRows) {
    if (row.label && row.label !== '—') {
      roleMap[row.address] = row.label;
    }
  }
  return roleMap;
}

export type GovRegistryStack = 'nave' | 'wargame';

function mergeUniqueAddresses(existing: string[], extra: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...existing, ...extra]) {
    const a = raw?.trim();
    if (!a) continue;
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

async function logWearerAddresses(params: {
  network: SupportedChainId;
  hatIds: string[];
  fromTxHash?: string | null;
  parentId?: string | null;
}): Promise<string[]> {
  const hatIds = params.hatIds.map((id) => id.trim()).filter(Boolean);
  if (hatIds.length === 0) return [];
  try {
    const rows = await withReadPlaneLimit(() =>
      getHatWearersForIds({
        network: params.network,
        hatIds,
        fromTxHash: params.fromTxHash,
        parentId: params.parentId,
      }),
    );
    return rows.flatMap((row) => row.addresses ?? []);
  } catch {
    return [];
  }
}

async function getGovStackDeployment(params: {
  stack?: GovRegistryStack;
  network: string;
  topHatId: string;
  parentId?: string | null;
}) {
  const args = {
    network: params.network,
    topHatId: params.topHatId,
    parentId: params.parentId,
  };
  if (params.stack === 'wargame') {
    return getWarGameDeployment(args);
  }
  return getNavePirataDeployment(args);
}

export async function fetchRolesTreeAnnotations(params: {
  network: SupportedChainId;
  topHatId: string;
  squadMemberEvmByNpub: Record<string, string>;
  squadAdminProxy?: string | null;
  squadAdminChain?: string | null;
  parentId?: string | null;
  /** Pacto Gov module addresses that may wear role hats. */
  protocolWearerCandidates?: string[];
  stack?: GovRegistryStack;
  fromTxHash?: string | null;
}): Promise<{
  roleLabelByHatId: Record<string, string>;
  wearerAddressesByHatId: Record<string, string[]>;
  executorRolesByAddress: Record<string, string>;
  error: string;
}> {
  const memberAddresses = Object.values(params.squadMemberEvmByNpub)
    .map((a) => a?.trim())
    .filter(Boolean) as string[];
  const protocolCandidates = (params.protocolWearerCandidates ?? [])
    .map((a) => a?.trim())
    .filter(Boolean) as string[];
  const seen = new Set<string>();
  const wearerCandidates: string[] = [];
  for (const a of [...memberAddresses, ...protocolCandidates]) {
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    wearerCandidates.push(a);
  }

  try {
    const deployment = await getGovStackDeployment({
      stack: params.stack,
      network: params.network,
      topHatId: params.topHatId,
      parentId: params.parentId,
    });
    const hatChecks = hatChecksForRolesTree(deployment, params.topHatId);
    const logAddresses = await logWearerAddresses({
      network: params.network,
      hatIds: hatChecks.map((c) => c.hatId),
      fromTxHash: params.fromTxHash,
      parentId: params.parentId,
    });
    const candidates = mergeUniqueAddresses(wearerCandidates, logAddresses);
    let assignments: Awaited<ReturnType<typeof getMemberHatWearers>> = [];
    if (candidates.length > 0) {
      assignments = await getMemberHatWearers({
        network: params.network,
        memberAddresses: candidates,
        hatChecks,
        parentId: params.parentId,
      });
    }
    let executorRolesByAddress: Record<string, string> = {};
    const squadAdminProxy = params.squadAdminProxy?.trim();
    if (squadAdminProxy && memberAddresses.length > 0) {
      executorRolesByAddress = await fetchExecutorRolesByAddress({
        network: params.network,
        squadAdminProxy,
        squadAdminChain: params.squadAdminChain ?? null,
        evmAddresses: memberAddresses,
        parentId: params.parentId,
      });
    }
    const maps = mergeRolesTreeAnnotationMaps(deployment, assignments, params.topHatId);
    return {
      roleLabelByHatId: maps.roleLabelByHatId,
      wearerAddressesByHatId: maps.wearerAddressesByHatId,
      executorRolesByAddress,
      error: '',
    };
  } catch (e) {
    return {
      roleLabelByHatId: {},
      wearerAddressesByHatId: {},
      executorRolesByAddress: {},
      error: getInvokeErrorMessage(e, 'Could not load role labels or hat wearers.'),
    };
  }
}

export async function fetchSettingsChainMemberMaps(params: {
  network: SupportedChainId;
  topHatId: string | null;
  squadAdminProxy: string | null;
  squadAdminChain: string | null;
  squadMemberEvmByNpub: Record<string, string>;
  parentId?: string | null;
  stack?: GovRegistryStack;
  fromTxHash?: string | null;
}): Promise<{
  memberHatByAddress: Record<string, string>;
  memberRolesByAddress: Record<string, string>;
  error: string;
}> {
  const rosterAddresses = Object.values(params.squadMemberEvmByNpub).filter(Boolean);
  if (rosterAddresses.length === 0 && !params.topHatId) {
    return { memberHatByAddress: {}, memberRolesByAddress: {}, error: '' };
  }

  try {
    let memberHatByAddress: Record<string, string> = {};
    let memberRolesByAddress: Record<string, string> = {};

    if (params.topHatId) {
      const deployment = await getGovStackDeployment({
        stack: params.stack,
        network: params.network,
        topHatId: params.topHatId,
        parentId: params.parentId,
      });
      const hatChecks = hatChecksFromNaveDeployment(deployment);
      const logAddresses = await logWearerAddresses({
        network: params.network,
        hatIds: hatChecks.map((c) => c.hatId),
        fromTxHash: params.fromTxHash,
        parentId: params.parentId,
      });
      const memberAddresses = mergeUniqueAddresses(rosterAddresses, logAddresses);
      if (memberAddresses.length > 0) {
        const assignments = await getMemberHatWearers({
          network: params.network,
          memberAddresses,
          hatChecks,
          parentId: params.parentId,
        });
        memberHatByAddress = memberHatByAddressFromAssignments(assignments);
      }
    }

    if (params.squadAdminProxy && rosterAddresses.length > 0) {
      memberRolesByAddress = await fetchExecutorRolesByAddress({
        network: params.network,
        squadAdminProxy: params.squadAdminProxy,
        squadAdminChain: params.squadAdminChain,
        evmAddresses: rosterAddresses,
        parentId: params.parentId,
      });
    }

    return { memberHatByAddress, memberRolesByAddress, error: '' };
  } catch (e) {
    return {
      memberHatByAddress: {},
      memberRolesByAddress: {},
      error: getInvokeErrorMessage(e, 'Could not load on-chain Hats or Roles for members.'),
    };
  }
}
