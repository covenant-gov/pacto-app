import { keccak256, type Hex } from 'viem';
import { normalizeCalldataHex } from '../evm/calldata-builder';
import type { TreasuryProposalDto } from './api';
import { parseGovReplicaSnapshot, type SquadGovReplicaRow } from './gov-replica';

const pendingByParent = new Map<string, Hex[]>();

/** True when overlay or chain supplied execute bytes (`0x` counts). */
export function hasTreasuryProposalCalldata(dataHex: string | null | undefined): boolean {
  return (dataHex ?? '').trim().length > 0;
}

function tryNormalizeCalldata(raw: string | null | undefined): Hex | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return normalizeCalldataHex(trimmed);
  } catch {
    return null;
  }
}

function normalizeDataHash(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(t)) return null;
  return t;
}

function calldataMatchesHash(dataHex: Hex, dataHash: string | null): boolean {
  if (!dataHash) return true;
  return keccak256(dataHex).toLowerCase() === dataHash;
}

/** Stash propose bytes until the chain row (dataHash) is readable. */
export function rememberTreasuryProposeCalldata(parentId: string, dataHex: string): void {
  const pid = parentId.trim();
  const n = tryNormalizeCalldata(dataHex);
  if (!pid || n == null) return;
  const list = pendingByParent.get(pid) ?? [];
  list.push(n);
  pendingByParent.set(pid, list);
}

export function resetPendingTreasuryProposeCalldata(): void {
  pendingByParent.clear();
}

export function treasuryProposalsFromReplicaRows(rows: SquadGovReplicaRow[]): TreasuryProposalDto[] {
  const byId = new Map<string, TreasuryProposalDto>();
  const sorted = [...rows].sort((a, b) => (a.updatedAtMs ?? 0) - (b.updatedAtMs ?? 0));
  for (const row of sorted) {
    const snap = parseGovReplicaSnapshot(row.snapshotJson);
    for (const p of snap?.treasuryProposals ?? []) {
      if (p?.proposalId) byId.set(p.proposalId, p);
    }
  }
  return [...byId.values()];
}

function consumePending(parentId: string, used: Hex[]): void {
  const list = pendingByParent.get(parentId);
  if (!list?.length) return;
  const remaining = [...list];
  for (const u of used) {
    const i = remaining.indexOf(u);
    if (i >= 0) remaining.splice(i, 1);
  }
  if (remaining.length) pendingByParent.set(parentId, remaining);
  else pendingByParent.delete(parentId);
}

/** Fill execute bytes from replica / propose stash. Chain `dataHex` stays empty after the ABI cutover. */
export function overlayTreasuryProposalCalldata(params: {
  chain: TreasuryProposalDto[];
  prior?: TreasuryProposalDto[] | null;
  extraCalldata?: string | null;
  parentId?: string | null;
}): TreasuryProposalDto[] {
  const priorById = new Map((params.prior ?? []).map((p) => [p.proposalId, p] as const));
  const pid = params.parentId?.trim() ?? '';
  const extras: Hex[] = [];
  if (pid) extras.push(...(pendingByParent.get(pid) ?? []));
  const extra = tryNormalizeCalldata(params.extraCalldata);
  if (extra) extras.push(extra);

  const used: Hex[] = [];

  const out = params.chain.map((row) => {
    if (hasTreasuryProposalCalldata(row.dataHex)) return row;
    const want = normalizeDataHash(row.dataHash);
    const priorHex = tryNormalizeCalldata(priorById.get(row.proposalId)?.dataHex);
    if (priorHex && calldataMatchesHash(priorHex, want)) {
      return { ...row, dataHex: priorHex };
    }
    if (want) {
      for (const c of extras) {
        if (!calldataMatchesHash(c, want)) continue;
        used.push(c);
        return { ...row, dataHex: c };
      }
    }
    return row;
  });

  const leftover = extras.filter((c) => !used.includes(c));
  if (leftover.length > 0) {
    const newestEmpty = out
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) =>
          !hasTreasuryProposalCalldata(row.dataHex) && !normalizeDataHash(row.dataHash),
      )
      .sort((a, b) => Number(b.row.proposalId) - Number(a.row.proposalId))[0];
    if (newestEmpty) {
      out[newestEmpty.index] = { ...newestEmpty.row, dataHex: leftover[0] };
      used.push(leftover[0]);
    }
  }

  if (pid) consumePending(pid, used);
  return out;
}
