import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  publishCommonsBroadcast,
  fetchCommonsBroadcasts,
  fetchCommonsBroadcastsCached,
  getLocalActiveCommonsBroadcast,
  cancelCommonsBroadcast,
} from './commons';
import type { CommonsBroadcastDto } from '../commons/types';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe('commons broadcast command wrappers', () => {
  it('publishCommonsBroadcast sends commons_publish_broadcast with input', async () => {
    const input = {
      subject: 'user' as const,
      subjectId: 'u1',
      message: 'hello',
      durationHours: 24 as const,
      tags: [],
    };
    mockedInvoke.mockResolvedValueOnce(input as unknown as CommonsBroadcastDto);
    const result = await publishCommonsBroadcast(input);
    expect(mockedInvoke).toHaveBeenCalledWith('commons_publish_broadcast', { input });
    expect(result).toEqual(input);
  });

  it('fetchCommonsBroadcasts sends commons_fetch_broadcasts with limit', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await fetchCommonsBroadcasts(5);
    expect(mockedInvoke).toHaveBeenCalledWith('commons_fetch_broadcasts', { limit: 5 });
  });

  it('fetchCommonsBroadcasts coerces undefined limit to null', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await fetchCommonsBroadcasts();
    expect(mockedInvoke).toHaveBeenCalledWith('commons_fetch_broadcasts', { limit: null });
  });

  it('fetchCommonsBroadcastsCached sends commons_list_cached_broadcasts with limit', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await fetchCommonsBroadcastsCached(10);
    expect(mockedInvoke).toHaveBeenCalledWith('commons_list_cached_broadcasts', { limit: 10 });
  });

  it('getLocalActiveCommonsBroadcast sends commons_get_local_active with subject and subjectId', async () => {
    mockedInvoke.mockResolvedValueOnce(null);
    const result = await getLocalActiveCommonsBroadcast('squad', 's1');
    expect(mockedInvoke).toHaveBeenCalledWith('commons_get_local_active', {
      subject: 'squad',
      subjectId: 's1',
    });
    expect(result).toBeNull();
  });

  it('cancelCommonsBroadcast sends commons_cancel_broadcast with subject and subjectId', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await cancelCommonsBroadcast('user', 'u1');
    expect(mockedInvoke).toHaveBeenCalledWith('commons_cancel_broadcast', {
      subject: 'user',
      subjectId: 'u1',
    });
  });
});
