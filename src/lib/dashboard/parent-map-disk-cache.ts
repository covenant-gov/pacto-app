/** Shared npub-scoped `Record<parentId, T[]>` localStorage helpers for dashboard caches. */

export const PARENT_MAP_DISK_CACHE_VERSION = 1 as const;

export interface ParentMapDiskBlob<T> {
  version: number;
  byParentId: Record<string, T[]>;
  fetchedAtMsByParentId: Record<string, number>;
}

function emptyBlob<T>(): ParentMapDiskBlob<T> {
  return {
    version: PARENT_MAP_DISK_CACHE_VERSION,
    byParentId: {},
    fetchedAtMsByParentId: {},
  };
}

export function readParentMapDiskBlob<T>(
  storageKey: string,
  validateArray: (x: unknown) => x is T[],
): ParentMapDiskBlob<T> | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<ParentMapDiskBlob<T>>;
    if (o.version !== PARENT_MAP_DISK_CACHE_VERSION || typeof o.byParentId !== 'object' || !o.byParentId) {
      return null;
    }
    const byParentId: Record<string, T[]> = {};
    for (const [parentId, rows] of Object.entries(o.byParentId)) {
      if (validateArray(rows)) byParentId[parentId] = rows;
    }
    const fetchedAtMsByParentId: Record<string, number> = {};
    if (typeof o.fetchedAtMsByParentId === 'object' && o.fetchedAtMsByParentId) {
      for (const [parentId, ms] of Object.entries(o.fetchedAtMsByParentId)) {
        if (typeof ms === 'number') fetchedAtMsByParentId[parentId] = ms;
      }
    }
    return { version: PARENT_MAP_DISK_CACHE_VERSION, byParentId, fetchedAtMsByParentId };
  } catch {
    return null;
  }
}

export function writeParentMapDiskEntry<T>(
  storageKey: string,
  parentId: string,
  entries: T[],
  validateArray: (x: unknown) => x is T[],
): number {
  if (typeof localStorage === 'undefined' || !parentId) return 0;
  const blob = readParentMapDiskBlob(storageKey, validateArray) ?? emptyBlob<T>();
  blob.byParentId[parentId] = entries;
  const fetchedAtMs = Date.now();
  blob.fetchedAtMsByParentId[parentId] = fetchedAtMs;
  try {
    localStorage.setItem(storageKey, JSON.stringify(blob));
  } catch {
    // ignore quota
  }
  return fetchedAtMs;
}

export function removeParentMapDiskEntry<T>(
  storageKey: string,
  parentId: string,
  validateArray: (x: unknown) => x is T[],
): void {
  if (typeof localStorage === 'undefined' || !parentId) return;
  const blob = readParentMapDiskBlob(storageKey, validateArray);
  if (!blob) return;
  if (!(parentId in blob.byParentId)) return;
  delete blob.byParentId[parentId];
  delete blob.fetchedAtMsByParentId[parentId];
  try {
    localStorage.setItem(storageKey, JSON.stringify(blob));
  } catch {
    // ignore quota
  }
}

export function readParentMapFetchedAtMs(
  storageKey: string,
  parentId: string,
  validateArray: (x: unknown) => x is unknown[],
): number | null {
  const blob = readParentMapDiskBlob(storageKey, validateArray);
  if (!blob) return null;
  const ms = blob.fetchedAtMsByParentId[parentId];
  return typeof ms === 'number' ? ms : null;
}
