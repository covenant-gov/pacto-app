import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get, writable } from 'svelte/store';
import { treasurySafesByParentId } from '../../stores/squads';
import { clearDashboardFetchMetaStores, treasurySafesFetchMetaByParentId } from './dashboard-fetch-meta';
import {
  TREASURY_SAFES_CACHE_PREFIX,
  hydrateTreasurySafesCacheFromDisk,
  hydrateTreasurySafesCacheIntoStore,
  persistTreasurySafesForParent,
  removeTreasurySafesCacheForParent,
  treasurySafesFetchedAtMs,
} from './treasury-safes-cache';
import type { TreasurySafeEntry } from '../treasury/treasury-safes';

describe('treasury-safes-cache', () => {
  const npub = 'npub1testtreasurycachexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
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
    treasurySafesByParentId.set({});
    clearDashboardFetchMetaStores();
  });

  it('round-trips treasury rows per parent id', () => {
    const rows: TreasurySafeEntry[] = [
      {
        id: 'entry-1',
        parentId,
        safeAddress: '0xabc',
        chain: 'sepolia',
        label: 'Vault',
        createdAtMs: 1,
      },
    ];
    persistTreasurySafesForParent(npub, parentId, rows);

    const target = writable<Record<string, TreasurySafeEntry[]>>({});
    hydrateTreasurySafesCacheIntoStore(npub, target);
    expect(get(target)[parentId]).toEqual(rows);
    expect(localStorage.getItem(`${TREASURY_SAFES_CACHE_PREFIX}_${npub}`)).toBeTruthy();
  });

  it('updates treasury safes fetch meta and exposes fetchedAtMs', () => {
    const rows: TreasurySafeEntry[] = [
      {
        id: 'entry-1',
        parentId,
        safeAddress: '0xabc',
        chain: 'sepolia',
        label: 'Vault',
        createdAtMs: 1,
      },
    ];
    persistTreasurySafesForParent(npub, parentId, rows);

    const meta = get(treasurySafesFetchMetaByParentId)[parentId];
    expect(meta.loading).toBe(false);
    expect(meta.error).toBeNull();
    expect(meta.fetchedAtMs).toBeGreaterThan(0);
    expect(treasurySafesFetchedAtMs(npub, parentId)).toBe(meta.fetchedAtMs);
  });

  it('removes treasury safes cache for a parent from disk and store', () => {
    const rows: TreasurySafeEntry[] = [
      {
        id: 'entry-1',
        parentId,
        safeAddress: '0xabc',
        chain: 'sepolia',
        label: 'Vault',
        createdAtMs: 1,
      },
    ];
    persistTreasurySafesForParent(npub, parentId, rows);
    hydrateTreasurySafesCacheFromDisk(npub);
    expect(get(treasurySafesByParentId)[parentId]).toEqual(rows);

    removeTreasurySafesCacheForParent(npub, parentId);

    expect(get(treasurySafesByParentId)[parentId]).toBeUndefined();
    expect(treasurySafesFetchedAtMs(npub, parentId)).toBeNull();
    expect(get(treasurySafesFetchMetaByParentId)[parentId]).toBeUndefined();

    treasurySafesByParentId.set({});
    hydrateTreasurySafesCacheFromDisk(npub);
    expect(get(treasurySafesByParentId)[parentId]).toBeUndefined();
  });
});
