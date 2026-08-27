import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  commonsHiddenRevision,
  getHiddenCommonsBroadcastIds,
  getHiddenCommonsBroadcasts,
  getHiddenCommonsCategoryIds,
  hideCommonsBroadcast,
  hideCommonsCategory,
  unhideCommonsBroadcast,
  unhideCommonsCategory,
} from './commons-hidden';

describe('commons hidden state', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    commonsHiddenRevision.set(0);
    // Test-only global mock; `as` cast is unavoidable for augmenting `globalThis`.
    const globalWithStorage = globalThis as unknown as { localStorage: Storage };
    globalWithStorage.localStorage = {
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
    setCurrentNpubForPersistence('npub1test');
  });

  afterEach(() => {
    const globalWithStorage = globalThis as unknown as { localStorage?: Storage };
    delete globalWithStorage.localStorage;
  });

  it('hides and unhides a broadcast, bumping the revision', () => {
    const before = get(commonsHiddenRevision);
    hideCommonsBroadcast({ eventId: 'evt1', title: 'Neo Builders', subtitle: 'Squad', tags: ['neo'] });
    expect(get(commonsHiddenRevision)).toBe(before + 1);
    expect(getHiddenCommonsBroadcastIds().has('evt1')).toBe(true);
    expect(getHiddenCommonsBroadcasts()[0]?.title).toBe('Neo Builders');

    unhideCommonsBroadcast('evt1');
    expect(get(commonsHiddenRevision)).toBe(before + 2);
    expect(getHiddenCommonsBroadcastIds().has('evt1')).toBe(false);
    expect(getHiddenCommonsBroadcasts()).toHaveLength(0);
  });

  it('lists hidden broadcasts newest-hidden first', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000_000);
      hideCommonsBroadcast({ eventId: 'first', title: 'First', subtitle: '', tags: [] });
      vi.setSystemTime(1_000_001_000);
      hideCommonsBroadcast({ eventId: 'second', title: 'Second', subtitle: '', tags: [] });
    } finally {
      vi.useRealTimers();
    }
    const records = getHiddenCommonsBroadcasts();
    expect(records.map((r) => r.eventId)).toEqual(['second', 'first']);
  });

  it('ignores unhiding a broadcast that was never hidden', () => {
    const before = get(commonsHiddenRevision);
    unhideCommonsBroadcast('missing');
    expect(get(commonsHiddenRevision)).toBe(before);
  });

  it('hides and unhides a category, bumping the revision', () => {
    const before = get(commonsHiddenRevision);
    hideCommonsCategory('politics');
    expect(get(commonsHiddenRevision)).toBe(before + 1);
    expect(getHiddenCommonsCategoryIds()).toEqual(['politics']);

    hideCommonsCategory('politics');
    expect(get(commonsHiddenRevision)).toBe(before + 1);

    unhideCommonsCategory('politics');
    expect(get(commonsHiddenRevision)).toBe(before + 2);
    expect(getHiddenCommonsCategoryIds()).toEqual([]);
  });

  it('scopes hidden state per npub', () => {
    hideCommonsBroadcast({ eventId: 'evt1', title: 'A', subtitle: '', tags: [] });
    setCurrentNpubForPersistence('npub1other');
    expect(getHiddenCommonsBroadcastIds().has('evt1')).toBe(false);
  });
});
