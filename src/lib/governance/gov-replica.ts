import { invoke } from '@tauri-apps/api/core';
import { squadRpcUrlsForInvoke } from '../squad/squad-rpc-invoke';
import type { MutinyStatusDto, QuartermasterPendingActionDto, TreasuryProposalDto } from './api';

export type GovReplicaStack = 'pacto_gov' | 'pacto_gov_wargame';

export interface SquadGovReplicaRow {
  parentId: string;
  stack: string;
  round: string;
  kind: string;
  blockNumber: number;
  txHash: string;
  snapshotJson: string;
  updatedAtMs: number;
}

export interface GovReplicaSnapshot {
  memberHatByAddress?: Record<string, string>;
  memberRolesByAddress?: Record<string, string>;
  wearerAddressesByHatId?: Record<string, string[]>;
  treasuryProposals?: TreasuryProposalDto[];
  qmPending?: QuartermasterPendingActionDto[];
  mutiny?: MutinyStatusDto;
}

export function parseGovReplicaSnapshot(raw: string | null | undefined): GovReplicaSnapshot | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as GovReplicaSnapshot;
  } catch {
    return null;
  }
}

export function replicaStackForDashboard(warGameStack: boolean): GovReplicaStack {
  return warGameStack ? 'pacto_gov_wargame' : 'pacto_gov';
}

export function pickReplicaRow(
  rows: SquadGovReplicaRow[],
  params: { stack: GovReplicaStack; kind: string; round?: string },
): SquadGovReplicaRow | null {
  const round = params.round?.trim() ?? '';
  return (
    rows.find(
      (r) => r.stack === params.stack && r.kind === params.kind && (r.round ?? '') === round,
    ) ?? null
  );
}

/** Replica may paint immediately; chain fills always continue. */
export function govReplicaChainFillPlan(_hit: {
  hasHats: boolean;
  hasProposals: boolean;
}): { applyReplica: true; fetchHats: true; fetchProposals: true } {
  return { applyReplica: true, fetchHats: true, fetchProposals: true };
}

export async function listSquadGovReplica(parentId: string): Promise<SquadGovReplicaRow[]> {
  const pid = parentId.trim();
  if (!pid) return [];
  const rows = (await invoke('list_squad_gov_replica', { parentId: pid })) as
    | SquadGovReplicaRow[]
    | null
    | undefined;
  return rows ?? [];
}

export function replicaSlicesFromSnapshot(
  snapshot: GovReplicaSnapshot,
): Array<{ kind: string; snapshot: GovReplicaSnapshot }> {
  const out: Array<{ kind: string; snapshot: GovReplicaSnapshot }> = [];
  const hats: GovReplicaSnapshot = {};
  if (snapshot.memberHatByAddress && Object.keys(snapshot.memberHatByAddress).length > 0) {
    hats.memberHatByAddress = snapshot.memberHatByAddress;
  }
  if (snapshot.memberRolesByAddress && Object.keys(snapshot.memberRolesByAddress).length > 0) {
    hats.memberRolesByAddress = snapshot.memberRolesByAddress;
  }
  if (snapshot.wearerAddressesByHatId && Object.keys(snapshot.wearerAddressesByHatId).length > 0) {
    hats.wearerAddressesByHatId = snapshot.wearerAddressesByHatId;
  }
  if (Object.keys(hats).length > 0) out.push({ kind: 'hats', snapshot: hats });
  if (snapshot.treasuryProposals?.length) {
    out.push({ kind: 'ta_proposal', snapshot: { treasuryProposals: snapshot.treasuryProposals } });
  }
  if (snapshot.qmPending?.length) {
    out.push({ kind: 'qm_pending', snapshot: { qmPending: snapshot.qmPending } });
  }
  if (snapshot.mutiny) {
    out.push({ kind: 'mutiny', snapshot: { mutiny: snapshot.mutiny } });
  }
  return out;
}

export async function persistGovReplicaSnapshot(params: {
  parentId: string;
  stack: GovReplicaStack;
  snapshot: GovReplicaSnapshot;
  blockNumber: number;
  round?: string;
  txHash?: string;
}): Promise<void> {
  for (const slice of replicaSlicesFromSnapshot(params.snapshot)) {
    await upsertSquadGovReplica({
      parentId: params.parentId,
      stack: params.stack,
      kind: slice.kind,
      snapshot: slice.snapshot,
      blockNumber: params.blockNumber,
      round: params.round,
      txHash: params.txHash,
    });
  }
}

export async function upsertSquadGovReplica(params: {
  parentId: string;
  stack: GovReplicaStack;
  kind: string;
  snapshot: GovReplicaSnapshot;
  blockNumber: number;
  round?: string;
  txHash?: string;
}): Promise<boolean> {
  return (await invoke('upsert_squad_gov_replica', {
    parentId: params.parentId.trim(),
    stack: params.stack,
    round: params.round?.trim() ?? '',
    kind: params.kind,
    blockNumber: params.blockNumber,
    txHash: params.txHash?.trim() ?? '',
    snapshotJson: JSON.stringify(params.snapshot),
  })) as boolean;
}

export async function getEvmBlockNumber(params: {
  network: string;
  parentId?: string | null;
}): Promise<number> {
  const raw = (await invoke('get_evm_block_number', {
    network: params.network,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as string;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : 0;
}
