import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const mockListCatchUpEntries = vi.hoisted(() => vi.fn());
const mockGetCatchUpCount = vi.hoisted(() => vi.fn());
const mockResolveCatchUpEntry = vi.hoisted(() => vi.fn());
const mockResolveAllCatchUpEntries = vi.hoisted(() => vi.fn());

vi.mock('../lib/api/catch-up', () => ({
  listCatchUpEntries: (...args: unknown[]) => mockListCatchUpEntries(...args),
  getCatchUpCount: (...args: unknown[]) => mockGetCatchUpCount(...args),
  resolveCatchUpEntry: (...args: unknown[]) => mockResolveCatchUpEntry(...args),
  resolveAllCatchUpEntries: (...args: unknown[]) => mockResolveAllCatchUpEntries(...args),
}));

import {
  catchUpCount,
  catchUpEntries,
  catchUpError,
  catchUpFilter,
  catchUpLoading,
  hydrateCatchUp,
  hydrateCatchUpCount,
  groupCatchUpEntriesBySquad,
  markAllCatchUpRead,
  resetCatchUpStore,
  resolveOneCatchUpEntry,
  setCatchUpFilter,
  type CatchUpFilter,
} from './catch-up';
import type { Squad } from './squads';
import type { CatchUpEntry } from '../lib/api/catch-up';

function entry(overrides: Partial<CatchUpEntry> = {}): CatchUpEntry {
  return {
    id: 'row-1',
    sourceEventId: 'evt-1',
    kind: 'mention',
    chatId: 'chat-1',
    createdAt: 1,
    resolvedAt: null,
    ...overrides,
  };
}

describe('catch-up store', () => {
  beforeEach(() => {
    mockListCatchUpEntries.mockReset();
    mockGetCatchUpCount.mockReset();
    mockResolveCatchUpEntry.mockReset();
    mockResolveAllCatchUpEntries.mockReset();
    resetCatchUpStore();
  });

  it('has expected initial values', () => {
    expect(get(catchUpEntries)).toEqual([]);
    expect(get(catchUpCount)).toBe(0);
    expect(get(catchUpLoading)).toBe(false);
    expect(get(catchUpError)).toBe('');
    expect(get(catchUpFilter)).toEqual({});
  });

  it('hydrateCatchUpCount populates the count without touching the entry list', async () => {
    mockGetCatchUpCount.mockResolvedValueOnce(4);
    await hydrateCatchUpCount();
    expect(get(catchUpCount)).toBe(4);
    expect(get(catchUpEntries)).toEqual([]);
  });

  it('hydrateCatchUp loads the entry list and count for the active filter', async () => {
    const entries = [entry({ sourceEventId: 'evt-1' }), entry({ sourceEventId: 'evt-2', id: 'row-2' })];
    mockListCatchUpEntries.mockResolvedValueOnce(entries);
    mockGetCatchUpCount.mockResolvedValueOnce(2);
    await hydrateCatchUp();
    expect(get(catchUpEntries)).toEqual(entries);
    expect(get(catchUpCount)).toBe(2);
    expect(get(catchUpLoading)).toBe(false);
  });

  it('hydrateCatchUp surfaces a load error and clears loading', async () => {
    mockListCatchUpEntries.mockRejectedValueOnce(new Error('boom'));
    mockGetCatchUpCount.mockResolvedValueOnce(0);
    await hydrateCatchUp();
    expect(get(catchUpError)).not.toBe('');
    expect(get(catchUpLoading)).toBe(false);
  });

  it('setCatchUpFilter updates the filter and reloads with it', async () => {
    mockListCatchUpEntries.mockResolvedValueOnce([]);
    mockGetCatchUpCount.mockResolvedValueOnce(0);
    const filter: CatchUpFilter = { kind: 'action_prompt' };
    setCatchUpFilter(filter);
    expect(get(catchUpFilter)).toEqual(filter);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockListCatchUpEntries).toHaveBeenCalledWith('action_prompt', undefined);
  });

  it('a stale hydrate does not clobber a newer one (last filter change wins)', async () => {
    const { promise, resolve: resolveFirst } = Promise.withResolvers<CatchUpEntry[]>();
    mockListCatchUpEntries.mockImplementationOnce(() => promise);
    mockGetCatchUpCount.mockResolvedValue(0);
    const firstHydrate = hydrateCatchUp();

    mockListCatchUpEntries.mockResolvedValueOnce([entry({ sourceEventId: 'evt-new' })]);
    const secondHydrate = hydrateCatchUp();
    await secondHydrate;
    expect(get(catchUpEntries)).toEqual([entry({ sourceEventId: 'evt-new' })]);

    // The first (slow) hydrate resolving afterward must not overwrite the newer result.
    resolveFirst([entry({ sourceEventId: 'evt-stale' })]);
    await firstHydrate;
    expect(get(catchUpEntries)).toEqual([entry({ sourceEventId: 'evt-new' })]);
  });

  it('resolveOneCatchUpEntry removes the entry from the list and refreshes the count', async () => {
    catchUpEntries.set([entry({ sourceEventId: 'evt-1' }), entry({ sourceEventId: 'evt-2', id: 'row-2' })]);
    mockResolveCatchUpEntry.mockResolvedValueOnce(true);
    mockGetCatchUpCount.mockResolvedValueOnce(1);
    await resolveOneCatchUpEntry('evt-1');
    expect(mockResolveCatchUpEntry).toHaveBeenCalledWith('evt-1');
    const remaining = get(catchUpEntries);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.sourceEventId).toBe('evt-2');
    expect(get(catchUpCount)).toBe(1);
  });

  it('markAllCatchUpRead resolves exactly the active filter and empties the list', async () => {
    catchUpEntries.set([entry(), entry({ id: 'row-2', sourceEventId: 'evt-2' })]);
    catchUpFilter.set({ squadId: 'squad-1' });
    mockResolveAllCatchUpEntries.mockResolvedValueOnce(2);
    mockGetCatchUpCount.mockResolvedValueOnce(0);
    await markAllCatchUpRead();
    expect(mockResolveAllCatchUpEntries).toHaveBeenCalledWith(undefined, 'squad-1');
    expect(get(catchUpEntries)).toEqual([]);
    expect(get(catchUpCount)).toBe(0);
  });

  it('resetCatchUpStore clears entries, count, error, and filter', async () => {
    catchUpEntries.set([entry()]);
    catchUpCount.set(9);
    catchUpError.set('failed');
    catchUpFilter.set({ kind: 'mention' });
    resetCatchUpStore();
    expect(get(catchUpEntries)).toEqual([]);
    expect(get(catchUpCount)).toBe(0);
    expect(get(catchUpError)).toBe('');
    expect(get(catchUpFilter)).toEqual({});
  });
});

describe('groupCatchUpEntriesBySquad', () => {
  function squad(id: string, groupIds: string[]): Squad {
    return {
      id,
      name: `Squad ${id}`,
      channels: groupIds.map((groupId, i) => ({ name: `ch-${i}`, groupId, order: i })),
      kind: 'squad',
      createdAt: 0,
      updatedAt: 0,
    } as Squad;
  }

  it('groups entries by the squad owning their chat id', () => {
    const squads = [squad('squad-1', ['grp-a']), squad('squad-2', ['grp-b'])];
    const entries = [
      entry({ sourceEventId: 'e1', chatId: 'grp-a' }),
      entry({ sourceEventId: 'e2', chatId: 'grp-b' }),
    ];
    const groups = groupCatchUpEntriesBySquad(entries, squads);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ key: 'squad-1', label: 'Squad squad-1' });
    expect(groups[1]).toMatchObject({ key: 'squad-2', label: 'Squad squad-2' });
  });

  it('puts entries with no matching squad channel (DMs, invites) in their own dms group', () => {
    const groups = groupCatchUpEntriesBySquad([entry({ chatId: 'npub1peer' })], []);
    expect(groups).toEqual([{ key: 'dms', label: null, entries: [entry({ chatId: 'npub1peer' })] }]);
  });

  it('the group holding the newest entry appears first, since input is already newest-first', () => {
    const squads = [squad('squad-1', ['grp-a']), squad('squad-2', ['grp-b'])];
    // grp-b's entry is listed first, so squad-2 must be the first group even though
    // squad-1 is declared first in the squads array.
    const entries = [
      entry({ sourceEventId: 'newest', chatId: 'grp-b' }),
      entry({ sourceEventId: 'older', chatId: 'grp-a' }),
    ];
    const groups = groupCatchUpEntriesBySquad(entries, squads);
    expect(groups.map((g) => g.key)).toEqual(['squad-2', 'squad-1']);
  });

  it('keeps entries within a group in their original relative order', () => {
    const squads = [squad('squad-1', ['grp-a'])];
    const entries = [
      entry({ sourceEventId: 'e1', chatId: 'grp-a' }),
      entry({ sourceEventId: 'e2', chatId: 'grp-a' }),
    ];
    const groups = groupCatchUpEntriesBySquad(entries, squads);
    expect(groups[0]?.entries.map((e) => e.sourceEventId)).toEqual(['e1', 'e2']);
  });
});
