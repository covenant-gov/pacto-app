import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get, writable } from 'svelte/store';
import { squadInfraByParentId } from '../../stores/squads';
import { clearDashboardFetchMetaStores, squadInfraFetchMetaByParentId } from './dashboard-fetch-meta';
import {
  SQUAD_INFRA_CACHE_PREFIX,
  hydrateSquadInfraCacheFromDisk,
  hydrateSquadInfraCacheIntoStore,
  persistSquadInfraForParent,
  removeSquadInfraCacheForParent,
  squadInfraFetchedAtMs,
} from './squad-infra-cache';
import type { SquadInfraDto } from '../governance/api';

describe('squad-infra-cache', () => {
  const npub = 'npub1testsquadinfra';
  const parentId = 'squad-parent-1';

  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    squadInfraByParentId.set({});
    clearDashboardFetchMetaStores();
  });

  function sampleInfra(): SquadInfraDto[] {
    return [
      {
        id: 'infra-1',
        parentId,
        infraType: 'pacto_gov',
        chain: 'sepolia',
        canonicalRef: '0x1',
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    ];
  }

  it('hydrates squad infra rows into the Svelte store', () => {
    const rows = sampleInfra();
    persistSquadInfraForParent(npub, parentId, rows);
    squadInfraByParentId.set({});
    hydrateSquadInfraCacheFromDisk(npub);
    expect(get(squadInfraByParentId)[parentId]).toEqual(rows);
    expect(localStorage.getItem(`${SQUAD_INFRA_CACHE_PREFIX}_${npub}`)).toBeTruthy();

    const meta = get(squadInfraFetchMetaByParentId)[parentId];
    expect(meta.loading).toBe(false);
    expect(meta.error).toBeNull();
    expect(meta.fetchedAtMs).toBeGreaterThan(0);
  });

  it('persists squad infra rows and updates fetch meta', () => {
    const rows = sampleInfra();
    persistSquadInfraForParent(npub, parentId, rows);
    expect(squadInfraFetchedAtMs(npub, parentId)).toBeGreaterThan(0);
  });

  it('removes squad infra cache for a parent from disk and store', () => {
    const rows = sampleInfra();
    persistSquadInfraForParent(npub, parentId, rows);
    hydrateSquadInfraCacheFromDisk(npub);
    expect(get(squadInfraByParentId)[parentId]).toEqual(rows);

    removeSquadInfraCacheForParent(npub, parentId);

    expect(get(squadInfraByParentId)[parentId]).toBeUndefined();
    expect(squadInfraFetchedAtMs(npub, parentId)).toBeNull();
    expect(get(squadInfraFetchMetaByParentId)[parentId]).toBeUndefined();

    squadInfraByParentId.set({});
    hydrateSquadInfraCacheFromDisk(npub);
    expect(get(squadInfraByParentId)[parentId]).toBeUndefined();
  });

  it('can hydrate into a provided writable store', () => {
    const rows = sampleInfra();
    persistSquadInfraForParent(npub, parentId, rows);
    const target = writable<Record<string, SquadInfraDto[]>>({});
    hydrateSquadInfraCacheIntoStore(npub, target);
    expect(get(target)[parentId]).toEqual(rows);
  });

  it('ignores invalid persisted rows during hydration', () => {
    store.set(
      `${SQUAD_INFRA_CACHE_PREFIX}_${npub}`,
      JSON.stringify({
        version: 1,
        byParentId: { [parentId]: [{ notAnInfraRow: true }] },
        fetchedAtMsByParentId: { [parentId]: 1 },
      }),
    );
    const target = writable<Record<string, SquadInfraDto[]>>({});
    hydrateSquadInfraCacheIntoStore(npub, target);
    expect(get(target)[parentId]).toBeUndefined();
  });
});
