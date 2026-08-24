import { invoke } from '@tauri-apps/api/core';
import {
  fetchQuartermasterPendingActions,
  fetchRolesTreeAnnotations,
  fetchSettingsChainMemberMaps,
  fetchSquadMemberEvmByNpub,
  fetchTreasuryProposals,
} from '../dashboard/parent-dashboard-loaders';
import { parseSupportedChainId, type SupportedChainId } from '../wallet/chains';
import {
  getEvmBlockNumber,
  type GovReplicaSnapshot,
  type GovReplicaStack,
} from './gov-replica';
import { getMutinyStatus, type SquadInfraDto } from './api';
import { memberHatByAddressFromWearerMaps } from './hats-tree-annotations';
import { parsePactoGovProviderPayload } from './pacto-gov-payload';
import { isActiveWarGameStack, parseWarGameRoundNumber } from './war-game-payload';

async function listInfra(parentId: string): Promise<SquadInfraDto[]> {
  const rows = (await invoke('list_squad_infra', { parentId })) as SquadInfraDto[] | null | undefined;
  return rows ?? [];
}

export async function resolveWriterReplicaTarget(parentId: string): Promise<{
  stack: GovReplicaStack;
  round: string;
  network: SupportedChainId;
  topHatId: string | null;
  squadAdminProxy: string | null;
  treasuryAuthority: string | null;
  quartermaster: string | null;
  mutinyModule: string | null;
} | null> {
  const rows = await listInfra(parentId);
  const wargame = rows.find((r) => r.infraType === 'pacto_gov_wargame');
  const live = rows.find((r) => r.infraType === 'pacto_gov');
  const row =
    wargame && isActiveWarGameStack(wargame.providerPayload) ? wargame : (live ?? wargame);
  if (!row) return null;
  const stack: GovReplicaStack =
    row.infraType === 'pacto_gov_wargame' ? 'pacto_gov_wargame' : 'pacto_gov';
  const payload = parsePactoGovProviderPayload(row.providerPayload);
  const round =
    stack === 'pacto_gov_wargame' ? String(parseWarGameRoundNumber(row.providerPayload) || '') : '';
  return {
    stack,
    round,
    network: parseSupportedChainId(row.chain || undefined),
    topHatId: row.canonicalRef?.trim() || null,
    squadAdminProxy: payload?.squadAdminProxy?.trim() || null,
    treasuryAuthority: payload?.treasuryAuthority?.trim() || null,
    quartermaster: payload?.quartermaster?.trim() || null,
    mutinyModule: payload?.mutinyModule?.trim() || null,
  };
}

/** Writer-only chain fill after a gov tx. Peers must not call this to answer sync. */
export async function buildWriterGovReplicaSnapshot(params: {
  parentId: string;
  kind: string;
}): Promise<{
  stack: GovReplicaStack;
  round: string;
  blockNumber: number;
  snapshot: GovReplicaSnapshot;
} | null> {
  const target = await resolveWriterReplicaTarget(params.parentId);
  if (!target) return null;
  const roster = await fetchSquadMemberEvmByNpub(params.parentId, params.parentId);
  const snapshot: GovReplicaSnapshot = {};
  const stack = target.stack === 'pacto_gov_wargame' ? 'wargame' : 'nave';

  if (target.topHatId) {
    const roles = await fetchRolesTreeAnnotations({
      network: target.network,
      topHatId: target.topHatId,
      squadMemberEvmByNpub: roster,
      squadAdminProxy: target.squadAdminProxy,
      squadAdminChain: target.network,
      parentId: params.parentId,
      stack,
    });
    if (!roles.error) {
      snapshot.wearerAddressesByHatId = roles.wearerAddressesByHatId;
      snapshot.memberRolesByAddress = roles.executorRolesByAddress;
      snapshot.memberHatByAddress = memberHatByAddressFromWearerMaps(
        roles.roleLabelByHatId,
        roles.wearerAddressesByHatId,
      );
    }
  } else if (target.squadAdminProxy) {
    const maps = await fetchSettingsChainMemberMaps({
      network: target.network,
      topHatId: null,
      squadAdminProxy: target.squadAdminProxy,
      squadAdminChain: target.network,
      squadMemberEvmByNpub: roster,
      parentId: params.parentId,
      stack,
    });
    if (!maps.error) {
      snapshot.memberHatByAddress = maps.memberHatByAddress;
      snapshot.memberRolesByAddress = maps.memberRolesByAddress;
    }
  }

  if (params.kind === 'ta_proposal' && target.treasuryAuthority) {
    const proposals = await fetchTreasuryProposals({
      network: target.network,
      treasuryAuthority: target.treasuryAuthority,
      parentId: params.parentId,
    });
    if (!proposals.error) snapshot.treasuryProposals = proposals.proposals;
  }
  if ((params.kind === 'qm_pending' || params.kind === 'crew_offboard') && target.quartermaster) {
    const pending = await fetchQuartermasterPendingActions({
      network: target.network,
      quartermaster: target.quartermaster,
      parentId: params.parentId,
    });
    if (!pending.error) snapshot.qmPending = pending.pending;
  }
  if (params.kind === 'mutiny' && target.mutinyModule) {
    try {
      snapshot.mutiny = await getMutinyStatus({
        network: target.network,
        mutinyModule: target.mutinyModule,
        parentId: params.parentId,
      });
    } catch {
      /* best-effort */
    }
  }

  let blockNumber = 0;
  try {
    blockNumber = await getEvmBlockNumber({ network: target.network, parentId: params.parentId });
  } catch {
    /* keep 0 */
  }

  const hasHats =
    !!snapshot.memberHatByAddress && Object.keys(snapshot.memberHatByAddress).length > 0;
  const hasRoles =
    !!snapshot.memberRolesByAddress && Object.keys(snapshot.memberRolesByAddress).length > 0;
  const hasWearers =
    !!snapshot.wearerAddressesByHatId && Object.keys(snapshot.wearerAddressesByHatId).length > 0;
  const hasProcess =
    (snapshot.treasuryProposals?.length ?? 0) > 0 ||
    (snapshot.qmPending?.length ?? 0) > 0 ||
    !!snapshot.mutiny;
  if (!hasHats && !hasRoles && !hasWearers && !hasProcess) return null;
  return { stack: target.stack, round: target.round, blockNumber, snapshot };
}
