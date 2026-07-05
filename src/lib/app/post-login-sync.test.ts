import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runPostLoginNetworkSync } from './post-login-sync';

const scheduleCommonsStartupPrefetch = vi.fn();
const apiConnect = vi.fn();
const fetchMessages = vi.fn();
const refreshProfileNow = vi.fn();
const syncMlsGroupsNow = vi.fn();
const dmSyncStatusSet = vi.fn();
const dmLog = vi.fn();
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

vi.mock('../api/auth', () => ({
  connect: (...args: unknown[]) => apiConnect(...args),
}));

vi.mock('../api/nostr', () => ({
  fetchMessages: (...args: unknown[]) => fetchMessages(...args),
  refreshProfileNow: (...args: unknown[]) => refreshProfileNow(...args),
  syncMlsGroupsNow: (...args: unknown[]) => syncMlsGroupsNow(...args),
}));

vi.mock('../utils/dm-debug', () => ({
  dmLog: (...args: unknown[]) => dmLog(...args),
}));

vi.mock('../../stores/dm', () => ({
  dmSyncStatus: { set: (...args: unknown[]) => dmSyncStatusSet(...args) },
}));

vi.mock('../commons/commons-prefetch', () => ({
  scheduleCommonsStartupPrefetch: (...args: unknown[]) =>
    scheduleCommonsStartupPrefetch(...args),
}));

describe('runPostLoginNetworkSync', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    consoleError.mockClear();
  });

  async function flushAsync(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  }

  it('starts commons prefetch and sets sync status', async () => {
    const connectDeferred = Promise.withResolvers<void>();
    apiConnect.mockReturnValue(connectDeferred.promise);
    fetchMessages.mockResolvedValue(undefined);
    refreshProfileNow.mockResolvedValue(undefined);
    syncMlsGroupsNow.mockResolvedValue(undefined);

    runPostLoginNetworkSync('npub1test');
    expect(scheduleCommonsStartupPrefetch).toHaveBeenCalled();
    expect(dmLog).toHaveBeenCalledWith('post-login: connect()');

    connectDeferred.resolve();
    await flushAsync();

    expect(dmLog).toHaveBeenCalledWith('post-login: connect() done');
    expect(dmLog).toHaveBeenCalledWith('post-login: fetchMessages(true)');
    expect(dmSyncStatusSet).toHaveBeenCalledWith('syncing');
    expect(fetchMessages).toHaveBeenCalledWith(true);
    expect(refreshProfileNow).toHaveBeenCalledWith('npub1test');
    expect(syncMlsGroupsNow).toHaveBeenCalledWith(null);
    expect(dmLog).toHaveBeenCalledWith('post-login: network sync done');
  });

  it('logs connect errors and continues', async () => {
    const connectDeferred = Promise.withResolvers<void>();
    apiConnect.mockReturnValue(connectDeferred.promise);
    fetchMessages.mockResolvedValue(undefined);
    refreshProfileNow.mockResolvedValue(undefined);
    syncMlsGroupsNow.mockResolvedValue(undefined);

    runPostLoginNetworkSync('npub1test');
    const err = new Error('connect failed');
    connectDeferred.reject(err);

    await flushAsync();

    expect(console.error).toHaveBeenCalledWith('connect after login failed:', err);
    expect(dmSyncStatusSet).toHaveBeenCalledWith('syncing');
    expect(refreshProfileNow).toHaveBeenCalledWith('npub1test');
  });

  it('logs fetchMessages rejection', async () => {
    apiConnect.mockResolvedValue(undefined);
    const fetchDeferred = Promise.withResolvers<undefined>();
    fetchMessages.mockReturnValue(fetchDeferred.promise);
    refreshProfileNow.mockResolvedValue(undefined);
    syncMlsGroupsNow.mockResolvedValue(undefined);

    runPostLoginNetworkSync('npub1test');
    const err = new Error('fetch failed');
    fetchDeferred.reject(err);

    await flushAsync();

    expect(console.error).toHaveBeenCalledWith('fetch_messages failed:', err);
  });

  it('logs refreshProfileNow rejection', async () => {
    apiConnect.mockResolvedValue(undefined);
    fetchMessages.mockResolvedValue(undefined);
    const refreshDeferred = Promise.withResolvers<void>();
    refreshProfileNow.mockReturnValue(refreshDeferred.promise);
    syncMlsGroupsNow.mockResolvedValue(undefined);

    runPostLoginNetworkSync('npub1test');
    const err = new Error('refresh failed');
    refreshDeferred.reject(err);

    await flushAsync();

    expect(console.error).toHaveBeenCalledWith('Auto profile refresh failed:', err);
  });

  it('logs syncMlsGroupsNow rejection', async () => {
    apiConnect.mockResolvedValue(undefined);
    fetchMessages.mockResolvedValue(undefined);
    refreshProfileNow.mockResolvedValue(undefined);
    const mlsDeferred = Promise.withResolvers<undefined>();
    syncMlsGroupsNow.mockReturnValue(mlsDeferred.promise);

    runPostLoginNetworkSync('npub1test');
    const err = new Error('mls failed');
    mlsDeferred.reject(err);

    await flushAsync();

    expect(console.error).toHaveBeenCalledWith('syncMlsGroupsNow after login failed:', err);
  });
});
