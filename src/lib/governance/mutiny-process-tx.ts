import { writable, get } from 'svelte/store';
import type { GovernanceProcessUpdatedPayload } from '../announcements';
import { persistenceKey } from '../../stores/persistence-context';
import { getExplorerTxUrl } from '../wallet/assets';
import { parseSupportedChainId } from '../wallet/chains';

export const MUTINY_PROCESS_TX_PREFIX = 'pacto_mutiny_process_tx_v1';

const TX_HASH = /^0x[a-fA-F0-9]{64}$/;

export type MutinyProcessTxRecord = {
  startTxHash?: string;
  lastTxHash?: string;
};

export const mutinyProcessTxByParentId = writable<Record<string, MutinyProcessTxRecord>>({});

function normalizeTxHash(raw: string | null | undefined): string {
  const h = raw?.trim() ?? '';
  if (!h) return '';
  const withPrefix = h.startsWith('0x') ? h : `0x${h}`;
  return TX_HASH.test(withPrefix) ? withPrefix.toLowerCase() : '';
}

function readPersistedMap(): Record<string, MutinyProcessTxRecord> {
  if (typeof localStorage === 'undefined') return {};
  const key = persistenceKey(MUTINY_PROCESS_TX_PREFIX);
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, MutinyProcessTxRecord> = {};
    for (const [parentId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const id = parentId.trim();
      if (!id || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const rec = value as Record<string, unknown>;
      const startTxHash = normalizeTxHash(
        typeof rec.startTxHash === 'string' ? rec.startTxHash : undefined,
      );
      const lastTxHash = normalizeTxHash(
        typeof rec.lastTxHash === 'string' ? rec.lastTxHash : undefined,
      );
      if (!startTxHash && !lastTxHash) continue;
      out[id] = {
        ...(startTxHash ? { startTxHash } : {}),
        ...(lastTxHash ? { lastTxHash } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writePersistedMap(map: Record<string, MutinyProcessTxRecord>): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(MUTINY_PROCESS_TX_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // quota
  }
}

export function hydrateMutinyProcessTxFromDisk(): void {
  mutinyProcessTxByParentId.set(readPersistedMap());
}

export function resetMutinyProcessTxStore(): void {
  mutinyProcessTxByParentId.set({});
}

export function recordMutinyProcessTx(params: {
  parentId: string;
  txHash: string;
  isStart?: boolean;
}): void {
  const parentId = params.parentId.trim();
  const txHash = normalizeTxHash(params.txHash);
  if (!parentId || !txHash) return;
  const map = { ...get(mutinyProcessTxByParentId) };
  const prev = map[parentId] ?? {};
  const next: MutinyProcessTxRecord = { ...prev, lastTxHash: txHash };
  if (params.isStart || !prev.startTxHash) {
    next.startTxHash = params.isStart ? txHash : (prev.startTxHash ?? txHash);
  }
  map[parentId] = next;
  mutinyProcessTxByParentId.set(map);
  writePersistedMap(map);
}

export function ingestMutinyProcessTxFromAnnounce(
  payload: GovernanceProcessUpdatedPayload | null | undefined,
): void {
  if (!payload || payload.kind !== 'mutiny') return;
  recordMutinyProcessTx({
    parentId: payload.parent_id,
    txHash: payload.tx_hash ?? '',
    isStart: false,
  });
}

/** Start hash when known; otherwise the latest mutiny process tx for this parent. */
export function mutinyTxHashForCard(
  map: Record<string, MutinyProcessTxRecord>,
  parentId: string,
): string {
  const rec = map[parentId.trim()];
  if (!rec) return '';
  return rec.startTxHash || rec.lastTxHash || '';
}

export function shortTxHash(txHash: string): string {
  const h = txHash.trim();
  if (h.length > 14) return `${h.slice(0, 10)}…${h.slice(-4)}`;
  return h;
}

export function mutinyTxExplorerUrl(network: string, txHash: string): string | null {
  const hash = normalizeTxHash(txHash);
  if (!hash) return null;
  return getExplorerTxUrl(parseSupportedChainId(network), hash);
}
