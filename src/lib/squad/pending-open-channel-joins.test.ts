import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  forgetPendingOpenChannelJoin,
  forgetPendingOpenChannelJoinsNotListed,
  loadPendingOpenChannelJoins,
  pendingOpenChannelJoins,
  PENDING_OPEN_CHANNEL_JOIN_TTL_MS,
  PENDING_OPEN_CHANNEL_JOINS_PREFIX,
  pruneExpiredPendingOpenChannelJoins,
  resetPendingOpenChannelJoins,
  upsertPendingOpenChannelJoin,
} from './pending-open-channel-joins';

describe('pending-open-channel-joins', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() {
        return storage.size;
      },
    } as Storage;
    setCurrentNpubForPersistence('npub1joiner');
    resetPendingOpenChannelJoins();
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    setCurrentNpubForPersistence(null);
  });

  it('upserts, replaces same group id, and reloads from disk', () => {
    upsertPendingOpenChannelJoin({
      parentId: 'ann-gid',
      groupId: 'g-c1',
      name: 'c1',
      access: 'open',
    });
    upsertPendingOpenChannelJoin({
      parentId: 'ann-gid',
      groupId: 'G-C1',
      name: 'ops',
      access: 'open',
    });
    expect(get(pendingOpenChannelJoins)).toHaveLength(1);
    expect(get(pendingOpenChannelJoins)[0]).toMatchObject({
      groupId: 'G-C1',
      name: 'ops',
    });
    expect(
      storage.get(`${PENDING_OPEN_CHANNEL_JOINS_PREFIX}_npub1joiner`)?.includes('ops'),
    ).toBe(true);

    resetPendingOpenChannelJoins();
    expect(get(pendingOpenChannelJoins)).toEqual([]);
    loadPendingOpenChannelJoins();
    expect(get(pendingOpenChannelJoins)[0]?.name).toBe('ops');
  });

  it('drops expired rows on load and prune', () => {
    const fresh = { parentId: 'p', groupId: 'g-new', name: 'new', access: 'open', at: Date.now() };
    const stale = {
      parentId: 'p',
      groupId: 'g-old',
      name: 'old',
      access: 'open',
      at: Date.now() - PENDING_OPEN_CHANNEL_JOIN_TTL_MS - 1000,
    };
    storage.set(
      `${PENDING_OPEN_CHANNEL_JOINS_PREFIX}_npub1joiner`,
      JSON.stringify([fresh, stale]),
    );
    loadPendingOpenChannelJoins();
    expect(get(pendingOpenChannelJoins).map((row) => row.groupId)).toEqual(['g-new']);

    pendingOpenChannelJoins.set([fresh, stale] as never);
    pruneExpiredPendingOpenChannelJoins();
    expect(get(pendingOpenChannelJoins).map((row) => row.groupId)).toEqual(['g-new']);
  });

  it('forgets a parent rows missing from the listed group ids', () => {
    for (const [parentId, groupId] of [
      ['p1', 'g-a'],
      ['p1', 'g-b'],
      ['p2', 'g-c'],
    ]) {
      upsertPendingOpenChannelJoin({ parentId, groupId, name: groupId, access: 'open' });
    }
    forgetPendingOpenChannelJoinsNotListed('p1', ['G-A']);
    expect(
      get(pendingOpenChannelJoins)
        .map((row) => row.groupId)
        .sort(),
    ).toEqual(['g-a', 'g-c']);
  });

  it('forgets a wanted row by group id', () => {
    upsertPendingOpenChannelJoin({
      parentId: 'ann-gid',
      groupId: 'g-c1',
      name: 'c1',
      access: 'open',
    });
    forgetPendingOpenChannelJoin('G-C1');
    expect(get(pendingOpenChannelJoins)).toEqual([]);
  });
});
