import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const mockListDashboardPolls = vi.hoisted(() => vi.fn());

vi.mock('../lib/api/nostr', () => ({
  listDashboardPolls: (...args: unknown[]) => mockListDashboardPolls(...args),
}));

import { currentUser } from './auth-session';
import { setCurrentNpubForPersistence } from './persistence-context';
import {
  LAST_SEEN_POLL_CREATED_AT_PREFIX,
  countUnseenPollCreates,
  lastSeenPollCreatedAtMsByParentId,
  loadLastSeenPollCreatedAt,
  markPollsChannelSeen,
  refreshUnseenPollCreatesForParent,
  resetPollsHubAlertStores,
  unseenPollCreateCountByParentId,
} from './polls-hub-alerts';
import type { DashboardPollDto } from '../lib/api/nostr';

const ME = 'npub1me';
const OTHER = 'npub1other';
const PARENT = 'parent-1';

function poll(partial: Partial<DashboardPollDto> & Pick<DashboardPollDto, 'id' | 'created_at_ms'>): DashboardPollDto {
  return {
    parent_id: PARENT,
    title: 't',
    description: '',
    options: [],
    created_by_npub: OTHER,
    ...partial,
  };
}

describe('polls hub alerts', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    });
    resetPollsHubAlertStores();
    currentUser.set({ npub: ME, pubkey: 'pk' });
    setCurrentNpubForPersistence(ME);
    mockListDashboardPolls.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    currentUser.set(null);
    setCurrentNpubForPersistence(null);
    resetPollsHubAlertStores();
  });

  it('countUnseenPollCreates ignores own creates and at-or-before watermark', () => {
    const polls = [
      poll({ id: 'a', created_at_ms: 100, created_by_npub: OTHER }),
      poll({ id: 'b', created_at_ms: 200, created_by_npub: ME }),
      poll({ id: 'c', created_at_ms: 300, created_by_npub: OTHER }),
    ];
    expect(countUnseenPollCreates(polls, 100, ME)).toBe(1);
    expect(countUnseenPollCreates(polls, 300, ME)).toBe(0);
  });

  it('vote-only replica refresh does not bump count when creates are already seen', async () => {
    lastSeenPollCreatedAtMsByParentId.set({ [PARENT]: 500 });
    mockListDashboardPolls.mockResolvedValue([
      poll({ id: 'a', created_at_ms: 400, created_by_npub: OTHER }),
    ]);
    await refreshUnseenPollCreatesForParent(PARENT);
    expect(get(unseenPollCreateCountByParentId)[PARENT]).toBe(0);
  });

  it('refresh counts creates newer than watermark from others', async () => {
    lastSeenPollCreatedAtMsByParentId.set({ [PARENT]: 100 });
    mockListDashboardPolls.mockResolvedValue([
      poll({ id: 'old', created_at_ms: 50, created_by_npub: OTHER }),
      poll({ id: 'mine', created_at_ms: 200, created_by_npub: ME }),
      poll({ id: 'new', created_at_ms: 250, created_by_npub: OTHER }),
    ]);
    await refreshUnseenPollCreatesForParent(PARENT);
    expect(get(unseenPollCreateCountByParentId)[PARENT]).toBe(1);
  });

  it('markPollsChannelSeen clears badge and persists max created_at', async () => {
    lastSeenPollCreatedAtMsByParentId.set({ [PARENT]: 0 });
    unseenPollCreateCountByParentId.set({ [PARENT]: 2 });
    mockListDashboardPolls.mockResolvedValue([
      poll({ id: 'a', created_at_ms: 100 }),
      poll({ id: 'b', created_at_ms: 400 }),
    ]);
    await markPollsChannelSeen(PARENT);
    expect(get(unseenPollCreateCountByParentId)[PARENT]).toBe(0);
    expect(get(lastSeenPollCreatedAtMsByParentId)[PARENT]).toBe(400);
    const key = `${LAST_SEEN_POLL_CREATED_AT_PREFIX}_${ME}`;
    expect(JSON.parse(storage.get(key) ?? '{}')).toEqual({ [PARENT]: 400 });
  });

  it('loadLastSeenPollCreatedAt restores persisted watermarks', () => {
    storage.set(`${LAST_SEEN_POLL_CREATED_AT_PREFIX}_${ME}`, JSON.stringify({ [PARENT]: 999 }));
    loadLastSeenPollCreatedAt(ME);
    expect(get(lastSeenPollCreatedAtMsByParentId)[PARENT]).toBe(999);
  });

  it('first sight persists a baseline so polls created before it never badge and later ones do', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    mockListDashboardPolls.mockResolvedValue([poll({ id: 'old', created_at_ms: 900 })]);
    await refreshUnseenPollCreatesForParent(PARENT);
    expect(get(unseenPollCreateCountByParentId)[PARENT]).toBe(0);
    const key = `${LAST_SEEN_POLL_CREATED_AT_PREFIX}_${ME}`;
    expect(JSON.parse(storage.get(key) ?? '{}')).toEqual({ [PARENT]: 1_000 });

    // A restart reloads the same baseline instead of resetting it to the new launch time.
    resetPollsHubAlertStores();
    vi.setSystemTime(5_000);
    loadLastSeenPollCreatedAt(ME);
    mockListDashboardPolls.mockResolvedValue([
      poll({ id: 'old', created_at_ms: 900 }),
      poll({ id: 'while-closed', created_at_ms: 2_000 }),
    ]);
    await refreshUnseenPollCreatesForParent(PARENT);
    expect(get(unseenPollCreateCountByParentId)[PARENT]).toBe(1);
    vi.useRealTimers();
  });

  it('markPollsChannelSeen never lowers an existing watermark', async () => {
    lastSeenPollCreatedAtMsByParentId.set({ [PARENT]: 800 });
    mockListDashboardPolls.mockResolvedValue([poll({ id: 'a', created_at_ms: 300 })]);
    await markPollsChannelSeen(PARENT);
    expect(get(lastSeenPollCreatedAtMsByParentId)[PARENT]).toBe(800);
  });

  it('overlapping refreshes coalesce into one trailing refetch', async () => {
    lastSeenPollCreatedAtMsByParentId.set({ [PARENT]: 0 });
    let resolveFirst: (rows: DashboardPollDto[]) => void = () => {};
    mockListDashboardPolls.mockImplementationOnce(
      () =>
        new Promise<DashboardPollDto[]>((resolve) => {
          resolveFirst = resolve;
        })
    );
    mockListDashboardPolls.mockResolvedValue([poll({ id: 'a', created_at_ms: 10 })]);
    const first = refreshUnseenPollCreatesForParent(PARENT);
    void refreshUnseenPollCreatesForParent(PARENT);
    void refreshUnseenPollCreatesForParent(PARENT);
    resolveFirst([]);
    await first;
    expect(mockListDashboardPolls).toHaveBeenCalledTimes(2);
    expect(get(unseenPollCreateCountByParentId)[PARENT]).toBe(1);
  });

  it('stale refresh cannot overwrite markPollsChannelSeen', async () => {
    lastSeenPollCreatedAtMsByParentId.set({ [PARENT]: 0 });
    let resolveList: (rows: DashboardPollDto[]) => void = () => {};
    mockListDashboardPolls.mockImplementationOnce(
      () =>
        new Promise<DashboardPollDto[]>((resolve) => {
          resolveList = resolve;
        })
    );
    const pending = refreshUnseenPollCreatesForParent(PARENT);
    mockListDashboardPolls.mockResolvedValueOnce([poll({ id: 'a', created_at_ms: 50 })]);
    await markPollsChannelSeen(PARENT);
    resolveList([poll({ id: 'late', created_at_ms: 900, created_by_npub: OTHER })]);
    await pending;
    expect(get(unseenPollCreateCountByParentId)[PARENT]).toBe(0);
    expect(get(lastSeenPollCreatedAtMsByParentId)[PARENT]).toBe(50);
  });
});
