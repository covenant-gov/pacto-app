import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  forgetPendingOpenChannelJoin,
  loadPendingOpenChannelJoins,
  pendingOpenChannelJoins,
  PENDING_OPEN_CHANNEL_JOINS_PREFIX,
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
