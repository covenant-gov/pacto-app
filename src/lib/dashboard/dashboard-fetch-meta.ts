import { writable } from 'svelte/store';

export interface DashboardFetchMeta {
  loading: boolean;
  error: string | null;
  fetchedAtMs: number | null;
}

export const treasurySafesFetchMetaByParentId = writable<Record<string, DashboardFetchMeta>>({});
export const squadInfraFetchMetaByParentId = writable<Record<string, DashboardFetchMeta>>({});

export function clearDashboardFetchMetaStores(): void {
  treasurySafesFetchMetaByParentId.set({});
  squadInfraFetchMetaByParentId.set({});
}

function mergeMeta(
  map: Record<string, DashboardFetchMeta>,
  parentId: string,
  patch: Partial<DashboardFetchMeta>,
): Record<string, DashboardFetchMeta> {
  const cur = map[parentId] ?? { loading: false, error: null, fetchedAtMs: null };
  return { ...map, [parentId]: { ...cur, ...patch } };
}

export function setTreasurySafesFetchMeta(parentId: string, patch: Partial<DashboardFetchMeta>): void {
  treasurySafesFetchMetaByParentId.update((m) => mergeMeta(m, parentId, patch));
}

export function setSquadInfraFetchMeta(parentId: string, patch: Partial<DashboardFetchMeta>): void {
  squadInfraFetchMetaByParentId.update((m) => mergeMeta(m, parentId, patch));
}
