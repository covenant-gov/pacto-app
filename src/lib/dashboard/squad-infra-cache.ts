import type { Writable } from 'svelte/store';
import type { SquadInfraDto } from '../governance/api';
import { squadInfraByParentId } from '../../stores/squads';
import {
  PARENT_MAP_DISK_CACHE_VERSION,
  readParentMapDiskBlob,
  readParentMapFetchedAtMs,
  writeParentMapDiskEntry,
} from './parent-map-disk-cache';
import { setSquadInfraFetchMeta } from './dashboard-fetch-meta';

export { PARENT_MAP_DISK_CACHE_VERSION as SQUAD_INFRA_CACHE_VERSION };
export const SQUAD_INFRA_CACHE_PREFIX = 'pacto_squad_infra_cache_v1';

function isSquadInfraDto(x: unknown): x is SquadInfraDto {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.parentId === 'string' &&
    typeof o.infraType === 'string' &&
    typeof o.chain === 'string' &&
    typeof o.canonicalRef === 'string' &&
    typeof o.createdAtMs === 'number' &&
    typeof o.updatedAtMs === 'number'
  );
}

function isSquadInfraDtoArray(x: unknown): x is SquadInfraDto[] {
  return Array.isArray(x) && x.every(isSquadInfraDto);
}

function storageKey(npub: string): string {
  return `${SQUAD_INFRA_CACHE_PREFIX}_${npub}`;
}

export function hydrateSquadInfraCacheFromDisk(npub: string): void {
  hydrateSquadInfraCacheIntoStore(npub, squadInfraByParentId);
}

export function hydrateSquadInfraCacheIntoStore(
  npub: string,
  target: Writable<Record<string, SquadInfraDto[]>>,
): void {
  const blob = readParentMapDiskBlob(storageKey(npub), isSquadInfraDtoArray);
  if (!blob) return;
  target.update((cur) => ({ ...cur, ...blob.byParentId }));
  for (const [parentId, fetchedAtMs] of Object.entries(blob.fetchedAtMsByParentId)) {
    setSquadInfraFetchMeta(parentId, { loading: false, error: null, fetchedAtMs });
  }
}

export function persistSquadInfraForParent(
  npub: string,
  parentId: string,
  entries: SquadInfraDto[],
): void {
  if (!npub || !parentId) return;
  const fetchedAtMs = writeParentMapDiskEntry(
    storageKey(npub),
    parentId,
    entries,
    isSquadInfraDtoArray,
  );
  setSquadInfraFetchMeta(parentId, { loading: false, error: null, fetchedAtMs });
}

export function squadInfraFetchedAtMs(npub: string, parentId: string): number | null {
  return readParentMapFetchedAtMs(storageKey(npub), parentId, isSquadInfraDtoArray);
}
