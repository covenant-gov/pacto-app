import type { Writable } from 'svelte/store';
import type { TreasurySafeEntry } from '../treasury/treasury-safes';
import { treasurySafesByParentId } from '../../stores/squads';
import {
  PARENT_MAP_DISK_CACHE_VERSION,
  readParentMapDiskBlob,
  readParentMapFetchedAtMs,
  removeParentMapDiskEntry,
  writeParentMapDiskEntry,
} from './parent-map-disk-cache';
import { setTreasurySafesFetchMeta, treasurySafesFetchMetaByParentId } from './dashboard-fetch-meta';

export { PARENT_MAP_DISK_CACHE_VERSION as TREASURY_SAFES_CACHE_VERSION };
export const TREASURY_SAFES_CACHE_PREFIX = 'pacto_treasury_safes_cache_v1';

function isTreasurySafeEntry(x: unknown): x is TreasurySafeEntry {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.parentId === 'string' &&
    typeof o.safeAddress === 'string' &&
    typeof o.chain === 'string' &&
    typeof o.label === 'string' &&
    typeof o.createdAtMs === 'number'
  );
}

function isTreasurySafeEntryArray(x: unknown): x is TreasurySafeEntry[] {
  return Array.isArray(x) && x.every(isTreasurySafeEntry);
}

function storageKey(npub: string): string {
  return `${TREASURY_SAFES_CACHE_PREFIX}_${npub}`;
}

export function hydrateTreasurySafesCacheFromDisk(npub: string): void {
  hydrateTreasurySafesCacheIntoStore(npub, treasurySafesByParentId);
}

export function hydrateTreasurySafesCacheIntoStore(
  npub: string,
  target: Writable<Record<string, TreasurySafeEntry[]>>,
): void {
  const blob = readParentMapDiskBlob(storageKey(npub), isTreasurySafeEntryArray);
  if (!blob) return;
  target.update((cur) => ({ ...cur, ...blob.byParentId }));
  for (const [parentId, fetchedAtMs] of Object.entries(blob.fetchedAtMsByParentId)) {
    setTreasurySafesFetchMeta(parentId, { loading: false, error: null, fetchedAtMs });
  }
}

export function persistTreasurySafesForParent(
  npub: string,
  parentId: string,
  entries: TreasurySafeEntry[],
): void {
  if (!npub || !parentId) return;
  const fetchedAtMs = writeParentMapDiskEntry(
    storageKey(npub),
    parentId,
    entries,
    isTreasurySafeEntryArray,
  );
  setTreasurySafesFetchMeta(parentId, { loading: false, error: null, fetchedAtMs });
}

export function treasurySafesFetchedAtMs(npub: string, parentId: string): number | null {
  return readParentMapFetchedAtMs(storageKey(npub), parentId, isTreasurySafeEntryArray);
}

export function removeTreasurySafesCacheForParent(npub: string, parentId: string): void {
  if (!npub || !parentId) return;
  removeParentMapDiskEntry(storageKey(npub), parentId, isTreasurySafeEntryArray);
  treasurySafesByParentId.update((cur) => {
    if (!(parentId in cur)) return cur;
    const next = { ...cur };
    delete next[parentId];
    return next;
  });
  treasurySafesFetchMetaByParentId.update((m) => {
    if (!(parentId in m)) return m;
    const next = { ...m };
    delete next[parentId];
    return next;
  });
}
