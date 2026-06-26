import type { Writable } from 'svelte/store';
import { squadMemberEvmByParentId } from '../../stores/squads';
import {
  PARENT_MAP_DISK_CACHE_VERSION,
  readParentMapDiskBlob,
  removeParentMapDiskEntry,
  writeParentMapDiskEntry,
} from './parent-map-disk-cache';

export { PARENT_MAP_DISK_CACHE_VERSION as SQUAD_MEMBER_EVM_CACHE_VERSION };
export const SQUAD_MEMBER_EVM_CACHE_PREFIX = 'pacto_squad_member_evm_cache_v1';

function isMemberEvmMap(x: unknown): x is Record<string, string> {
  if (!x || typeof x !== 'object') return false;
  return Object.entries(x).every(([k, v]) => typeof k === 'string' && typeof v === 'string');
}

function isMemberEvmMapArray(x: unknown): x is Record<string, string>[] {
  return Array.isArray(x) && x.every(isMemberEvmMap);
}

/** Stored as a single-element array per parent for parent-map-disk-cache reuse. */
function wrapMap(map: Record<string, string>): Record<string, string>[] {
  return [map];
}

function unwrapMap(rows: Record<string, string>[]): Record<string, string> {
  return rows[0] ?? {};
}

function storageKey(npub: string): string {
  return `${SQUAD_MEMBER_EVM_CACHE_PREFIX}_${npub}`;
}

export function hydrateSquadMemberEvmCacheFromDisk(npub: string): void {
  hydrateSquadMemberEvmCacheIntoStore(npub, squadMemberEvmByParentId);
}

export function hydrateSquadMemberEvmCacheIntoStore(
  npub: string,
  target: Writable<Record<string, Record<string, string>>>,
): void {
  const blob = readParentMapDiskBlob(storageKey(npub), isMemberEvmMapArray);
  if (!blob) return;
  const byParentId: Record<string, Record<string, string>> = {};
  for (const [parentId, rows] of Object.entries(blob.byParentId)) {
    byParentId[parentId] = unwrapMap(rows);
  }
  target.update((cur) => ({ ...cur, ...byParentId }));
}

export function persistSquadMemberEvmForParent(
  npub: string,
  parentId: string,
  map: Record<string, string>,
): void {
  if (!npub || !parentId) return;
  writeParentMapDiskEntry(storageKey(npub), parentId, wrapMap(map), isMemberEvmMapArray);
}

export function getCachedSquadMemberEvmForParent(
  npub: string,
  parentId: string,
): Record<string, string> | null {
  const blob = readParentMapDiskBlob(storageKey(npub), isMemberEvmMapArray);
  if (!blob?.byParentId[parentId]) return null;
  return unwrapMap(blob.byParentId[parentId]);
}

export function removeSquadMemberEvmCacheForParent(npub: string, parentId: string): void {
  if (!npub || !parentId) return;
  removeParentMapDiskEntry(storageKey(npub), parentId, isMemberEvmMapArray);
  squadMemberEvmByParentId.update((cur) => {
    if (!(parentId in cur)) return cur;
    const next = { ...cur };
    delete next[parentId];
    return next;
  });
}
