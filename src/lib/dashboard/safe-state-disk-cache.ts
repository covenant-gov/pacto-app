import type { Address } from 'viem';
import type { SafeStateEntry } from '../../stores/safe';
import type { SafeState } from '../wallet/safe';
import type { SupportedChainId } from '../wallet/chains';

export const SAFE_STATE_DISK_CACHE_VERSION = 1 as const;
export const SAFE_STATE_DISK_CACHE_PREFIX = 'pacto_safe_state_cache_v1';
export const SAFE_STATE_DISK_TTL_MS = 15 * 60 * 1000;

interface SafeStateWire {
  address: string;
  owners: string[];
  threshold: number;
  nonce: string;
  balanceWei: string;
  balanceFormatted: string;
}

interface SafeStateDiskRow {
  safeAddress: string;
  chainId: SupportedChainId;
  wire: SafeStateWire;
  lastFetchedAt: number;
}

interface SafeStateDiskBlob {
  version: number;
  byTreasuryEntryId: Record<string, SafeStateDiskRow>;
}

function storageKey(npub: string): string {
  return `${SAFE_STATE_DISK_CACHE_PREFIX}_${npub}`;
}

function toWire(state: SafeState): SafeStateWire {
  return {
    address: state.address,
    owners: state.owners,
    threshold: state.threshold,
    nonce: state.nonce.toString(),
    balanceWei: state.balanceWei.toString(),
    balanceFormatted: state.balanceFormatted,
  };
}

function fromWire(wire: SafeStateWire): SafeState {
  return {
    address: wire.address as Address,
    owners: wire.owners as Address[],
    threshold: wire.threshold,
    nonce: BigInt(wire.nonce),
    balanceWei: BigInt(wire.balanceWei),
    balanceFormatted: wire.balanceFormatted,
  };
}

function readBlob(npub: string): SafeStateDiskBlob | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(storageKey(npub));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<SafeStateDiskBlob>;
    if (o.version !== SAFE_STATE_DISK_CACHE_VERSION || typeof o.byTreasuryEntryId !== 'object') {
      return null;
    }
    return {
      version: SAFE_STATE_DISK_CACHE_VERSION,
      byTreasuryEntryId: (o.byTreasuryEntryId ?? {}) as Record<string, SafeStateDiskRow>,
    };
  } catch {
    return null;
  }
}

export function hydrateSafeStateCacheFromDisk(
  npub: string,
  merge: (rows: Record<string, SafeStateEntry>) => void,
): void {
  const blob = readBlob(npub);
  if (!blob) return;
  const now = Date.now();
  const next: Record<string, SafeStateEntry> = {};
  for (const [treasuryEntryId, row] of Object.entries(blob.byTreasuryEntryId)) {
    if (now - row.lastFetchedAt > SAFE_STATE_DISK_TTL_MS) continue;
    next[treasuryEntryId] = {
      treasuryEntryId,
      safeAddress: row.safeAddress,
      chainId: row.chainId,
      state: fromWire(row.wire),
      error: null,
      loading: false,
      lastFetchedAt: row.lastFetchedAt,
    };
  }
  if (Object.keys(next).length > 0) merge(next);
}

export function persistSafeStateCacheEntry(npub: string, entry: SafeStateEntry): void {
  if (typeof localStorage === 'undefined' || !npub || !entry.state || !entry.lastFetchedAt) return;
  const blob = readBlob(npub) ?? {
    version: SAFE_STATE_DISK_CACHE_VERSION,
    byTreasuryEntryId: {},
  };
  blob.byTreasuryEntryId[entry.treasuryEntryId] = {
    safeAddress: entry.safeAddress,
    chainId: entry.chainId,
    wire: toWire(entry.state),
    lastFetchedAt: entry.lastFetchedAt,
  };
  try {
    localStorage.setItem(storageKey(npub), JSON.stringify(blob));
  } catch {
    // ignore quota
  }
}
