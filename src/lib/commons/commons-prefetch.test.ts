import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { fetchCommonsBroadcasts, fetchCommonsBroadcastsCached } from '../api/commons';
import {
  commonsBroadcasts,
  commonsFeedError,
  commonsFeedSyncing,
  refreshCommonsBroadcasts,
  resetCommonsPrefetchSession,
  scheduleCommonsStartupPrefetch,
} from './commons-prefetch';
import type { CommonsBroadcastDto } from './types';

vi.mock('../api/commons', () => ({
  fetchCommonsBroadcasts: vi.fn(),
  fetchCommonsBroadcastsCached: vi.fn(),
}));

vi.mock('../utils/tauri-errors', () => ({
  getInvokeErrorMessage: vi.fn((e: unknown, fallback: string) =>
    typeof e === 'string' && e ? e : fallback
  ),
}));

describe('commons-prefetch', () => {
  const ImageMock = vi.fn(function () {
    return { src: '' };
  });

  beforeEach(() => {
    vi.stubGlobal('Image', ImageMock);
    resetCommonsPrefetchSession();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetCommonsPrefetchSession();
  });

  function makeDto(): CommonsBroadcastDto {
    return {
      eventId: 'evt1',
      authorNpub: 'npub1author',
      subject: 'user',
      subjectId: 'npub1author',
      message: 'Hello',
      durationHours: 24,
      expiresAt: 1_000_000,
      tags: ['neo'],
      createdAt: 1,
    };
  }

  it('resetCommonsPrefetchSession clears stores and allows another prefetch', async () => {
    vi.mocked(fetchCommonsBroadcastsCached).mockResolvedValue([]);

    scheduleCommonsStartupPrefetch();
    await vi.waitFor(() => expect(fetchCommonsBroadcastsCached).toHaveBeenCalledTimes(1));

    resetCommonsPrefetchSession();
    expect(get(commonsBroadcasts)).toEqual([]);
    expect(get(commonsFeedError)).toBeNull();
    expect(get(commonsFeedSyncing)).toBe(false);

    scheduleCommonsStartupPrefetch();
    await vi.waitFor(() => expect(fetchCommonsBroadcastsCached).toHaveBeenCalledTimes(2));
  });

  it('scheduleCommonsStartupPrefetch ignores cached prefetch errors', async () => {
    vi.mocked(fetchCommonsBroadcastsCached).mockRejectedValueOnce(new Error('db locked'));

    scheduleCommonsStartupPrefetch();

    await vi.waitFor(() => expect(fetchCommonsBroadcastsCached).toHaveBeenCalledTimes(1));
    expect(get(commonsBroadcasts)).toEqual([]);
  });
  it('scheduleCommonsStartupPrefetch loads cached broadcasts into the store', async () => {
    const rows = [makeDto()];
    vi.mocked(fetchCommonsBroadcastsCached).mockResolvedValue(rows);

    scheduleCommonsStartupPrefetch();

    await vi.waitFor(() => expect(fetchCommonsBroadcastsCached).toHaveBeenCalledTimes(1));
    expect(get(commonsBroadcasts)).toEqual(rows);
  });

  it('scheduleCommonsStartupPrefetch is idempotent', async () => {
    vi.mocked(fetchCommonsBroadcastsCached).mockResolvedValue([]);

    scheduleCommonsStartupPrefetch();
    scheduleCommonsStartupPrefetch();

    await vi.waitFor(() => expect(fetchCommonsBroadcastsCached).toHaveBeenCalledTimes(1));
    expect(ImageMock).toHaveBeenCalled();
  });

  it('refreshCommonsBroadcasts loads rows into the store', async () => {
    const rows = [makeDto()];
    vi.mocked(fetchCommonsBroadcasts).mockResolvedValue(rows);

    const result = await refreshCommonsBroadcasts();

    expect(fetchCommonsBroadcasts).toHaveBeenCalledWith(100);
    expect(result).toEqual(rows);
    expect(get(commonsBroadcasts)).toEqual(rows);
    expect(get(commonsFeedSyncing)).toBe(false);
    expect(get(commonsFeedError)).toBeNull();
  });

  it('refreshCommonsBroadcasts handles errors and clears the store', async () => {
    vi.mocked(fetchCommonsBroadcasts).mockRejectedValue('network error');

    const result = await refreshCommonsBroadcasts();

    expect(result).toEqual([]);
    expect(get(commonsBroadcasts)).toEqual([]);
    expect(get(commonsFeedError)).toBe('network error');
    expect(get(commonsFeedSyncing)).toBe(false);
  });

  it('refreshCommonsBroadcasts in silent mode does not toggle syncing', async () => {
    const rows = [makeDto()];
    vi.mocked(fetchCommonsBroadcasts).mockResolvedValue(rows);

    await refreshCommonsBroadcasts({ silent: true });

    expect(get(commonsBroadcasts)).toEqual(rows);
    expect(get(commonsFeedSyncing)).toBe(false);
  });
});
