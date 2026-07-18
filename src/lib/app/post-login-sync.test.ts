import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runPostLoginNetworkSync } from './post-login-sync';
import * as updateCheck from '../updater/update-check';
import {
  startupCheckEnabled,
  markStartupCheckRun,
  resetStartupCheckSession,
  getHasRunStartupCheckThisSession,
} from '../../stores/startup-check';

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

vi.mock('../updater/update-check', () => ({
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
  isDevBuild: vi.fn().mockReturnValue(false),
  updateStatus: { setStatus: vi.fn() },
  resetUpdateStatus: vi.fn(),
  setIsDevBuildForTest: vi.fn(),
}));

describe('runPostLoginNetworkSync', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    resetStartupCheckSession();
    startupCheckEnabled.set(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    consoleError.mockClear();
    resetStartupCheckSession();
    startupCheckEnabled.set(false);
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

  describe('startup update check', () => {
    beforeEach(() => {
      vi.spyOn(updateCheck, 'isDevBuild').mockReturnValue(false);
      vi.spyOn(updateCheck, 'checkForUpdates').mockResolvedValue(undefined);
    });

    it('does not check when the preference is disabled', async () => {
      startupCheckEnabled.set(false);
      runPostLoginNetworkSync('npub1');
      await flushAsync();
      expect(updateCheck.checkForUpdates).not.toHaveBeenCalled();
    });

    it('does not check when the session has already been checked', async () => {
      startupCheckEnabled.set(true);
      markStartupCheckRun();
      runPostLoginNetworkSync('npub1');
      await flushAsync();
      expect(updateCheck.checkForUpdates).not.toHaveBeenCalled();
      expect(getHasRunStartupCheckThisSession()).toBe(true);
    });

    it('does not check in dev builds', async () => {
      vi.spyOn(updateCheck, 'isDevBuild').mockReturnValue(true);
      startupCheckEnabled.set(true);
      runPostLoginNetworkSync('npub1');
      await flushAsync();
      expect(updateCheck.checkForUpdates).not.toHaveBeenCalled();
    });

    it('runs exactly once when enabled in a release build', async () => {
      startupCheckEnabled.set(true);
      runPostLoginNetworkSync('npub1');
      await flushAsync();
      expect(updateCheck.checkForUpdates).toHaveBeenCalledTimes(1);
      expect(getHasRunStartupCheckThisSession()).toBe(true);

      runPostLoginNetworkSync('npub1');
      await flushAsync();
      expect(updateCheck.checkForUpdates).toHaveBeenCalledTimes(1);
    });

    it('calls updateStatus.setStatus when an update is found', async () => {
      startupCheckEnabled.set(true);
      vi.spyOn(updateCheck, 'checkForUpdates').mockImplementation(async () => {
        updateCheck.updateStatus.setStatus('available', {
          currentVersion: '0.2.0',
          availableVersion: '0.3.0',
        });
      });
      runPostLoginNetworkSync('npub1');
      await flushAsync();
      expect(updateCheck.updateStatus.setStatus).toHaveBeenCalledWith('available', {
        currentVersion: '0.2.0',
        availableVersion: '0.3.0',
      });
    });
  });
});
