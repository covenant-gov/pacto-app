import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get, writable } from 'svelte/store';
import { squadMemberEvmByParentId } from '../../stores/squads';
import {
  SQUAD_MEMBER_EVM_CACHE_PREFIX,
  hydrateSquadMemberEvmCacheFromDisk,
  hydrateSquadMemberEvmCacheIntoStore,
  persistSquadMemberEvmForParent,
  getCachedSquadMemberEvmForParent,
  removeSquadMemberEvmCacheForParent,
} from './squad-member-evm-cache';

describe('squad-member-evm-cache', () => {
  const npub = 'npub1testsquadmemberevm';
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
    squadMemberEvmByParentId.set({});
  });

  function sampleMap(): Record<string, string> {
    return { npub1: '0xabc', npub2: '0xdef' };
  }

  it('hydrates squad member evm mapping into the Svelte store', () => {
    const map = sampleMap();
    persistSquadMemberEvmForParent(npub, parentId, map);
    squadMemberEvmByParentId.set({});
    hydrateSquadMemberEvmCacheFromDisk(npub);
    expect(get(squadMemberEvmByParentId)[parentId]).toEqual(map);
    expect(localStorage.getItem(`${SQUAD_MEMBER_EVM_CACHE_PREFIX}_${npub}`)).toBeTruthy();
  });

  it('returns cached map for a parent or null when missing', () => {
    const map = sampleMap();
    persistSquadMemberEvmForParent(npub, parentId, map);
    expect(getCachedSquadMemberEvmForParent(npub, parentId)).toEqual(map);
    expect(getCachedSquadMemberEvmForParent(npub, 'other-parent')).toBeNull();
  });

  it('removes squad member evm cache for a parent from disk and store', () => {
    const map = sampleMap();
    persistSquadMemberEvmForParent(npub, parentId, map);
    hydrateSquadMemberEvmCacheFromDisk(npub);
    expect(get(squadMemberEvmByParentId)[parentId]).toEqual(map);

    removeSquadMemberEvmCacheForParent(npub, parentId);

    expect(get(squadMemberEvmByParentId)[parentId]).toBeUndefined();
    expect(getCachedSquadMemberEvmForParent(npub, parentId)).toBeNull();

    squadMemberEvmByParentId.set({});
    hydrateSquadMemberEvmCacheFromDisk(npub);
    expect(get(squadMemberEvmByParentId)[parentId]).toBeUndefined();
  });

  it('can hydrate into a provided writable store', () => {
    const map = sampleMap();
    persistSquadMemberEvmForParent(npub, parentId, map);
    const target = writable<Record<string, Record<string, string>>>({});
    hydrateSquadMemberEvmCacheIntoStore(npub, target);
    expect(get(target)[parentId]).toEqual(map);
  });

  it('ignores invalid persisted maps during hydration', () => {
    store.set(
      `${SQUAD_MEMBER_EVM_CACHE_PREFIX}_${npub}`,
      JSON.stringify({
        version: 1,
        byParentId: { [parentId]: [{ notAMap: true }] },
        fetchedAtMsByParentId: { [parentId]: 1 },
      }),
    );
    const target = writable<Record<string, Record<string, string>>>({});
    hydrateSquadMemberEvmCacheIntoStore(npub, target);
    expect(get(target)[parentId]).toBeUndefined();
  });
});
