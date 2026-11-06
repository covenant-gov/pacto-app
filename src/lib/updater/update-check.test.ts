import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { getVersion } from '@tauri-apps/api/app';
import {
  checkForUpdates,
  dismissUpdatePanel,
  downloadAndInstallUpdate,
  relaunchApp,
  updateStatus,
  resetUpdateStatus,
  resetMemoizedUpdateCheckForTest,
  getMemoizedUpdateCheck,
  setIsDevBuildForTest,
  buildCommitHash,
  buildVersion,
  type UpdateState,
  type UpdaterUpdate,
} from './update-check';

import { rememberVersionBeforeUpdate } from './whats-new';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';

import { showToast } from '../../stores/toast';


vi.mock('@tauri-apps/plugin-updater');
vi.mock('@tauri-apps/api/app');
vi.mock('@tauri-apps/api/core');
vi.mock('../../stores/toast', () => ({
  showToast: vi.fn(),
  toastMessage: { set: vi.fn(), subscribe: vi.fn() },
  clearToast: vi.fn(),
  runToastRetryAction: vi.fn(),
  pendingReadyToast: { set: vi.fn(), subscribe: vi.fn() },
}));

const mockedCheck = vi.mocked(check);
const mockedGetVersion = vi.mocked(getVersion);
const mockedInvoke = vi.mocked(invoke);
const mockedShowToast = vi.mocked(showToast);

beforeEach(() => {
  vi.resetAllMocks();
  mockedGetVersion.mockResolvedValue('0.2.0');
  resetUpdateStatus();
  resetMemoizedUpdateCheckForTest();
  setCurrentNpubForPersistence(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function expectStatus(status: UpdateState['status'], extra?: Partial<UpdateState>) {
  const state = get(updateStatus);
  expect(state.status).toBe(status);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      expect(state[key as keyof UpdateState]).toEqual(value);
    }
  }
}

describe('getMemoizedUpdateCheck', () => {
  it('coalesces concurrent callers into one underlying check() call', async () => {
    setIsDevBuildForTest(false);
    const { promise, resolve } = Promise.withResolvers<UpdaterUpdate>();
    mockedCheck.mockReturnValue(promise);

    const first = getMemoizedUpdateCheck();
    const second = getMemoizedUpdateCheck();
    resolve({ version: '0.3.0' } as UpdaterUpdate);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(mockedCheck).toHaveBeenCalledTimes(1);
    expect(firstResult).toBe(secondResult);
  });

  it('makes a fresh request after a successful call settles', async () => {
    setIsDevBuildForTest(false);
    mockedCheck.mockResolvedValueOnce({ version: '0.3.0' } as UpdaterUpdate);
    await getMemoizedUpdateCheck();

    mockedCheck.mockResolvedValueOnce({ version: '0.4.0' } as UpdaterUpdate);
    const second = await getMemoizedUpdateCheck();

    expect(mockedCheck).toHaveBeenCalledTimes(2);
    expect(second).toEqual({ version: '0.4.0' });
  });

  it('makes a fresh request after a rejection settles - a retry is not stuck replaying the same failure', async () => {
    setIsDevBuildForTest(false);
    mockedCheck.mockRejectedValueOnce(new Error('network unreachable'));
    await expect(getMemoizedUpdateCheck()).rejects.toThrow('network unreachable');

    mockedCheck.mockResolvedValueOnce({ version: '0.3.0' } as UpdaterUpdate);
    const retry = await getMemoizedUpdateCheck();

    expect(mockedCheck).toHaveBeenCalledTimes(2);
    expect(retry).toEqual({ version: '0.3.0' });
  });
});

describe('checkForUpdates', () => {
  it('falls back to the build version when getVersion() returns 0.0.0', async () => {
    setIsDevBuildForTest(true);
    mockedGetVersion.mockResolvedValue('0.0.0');
    await checkForUpdates();
    expect(mockedGetVersion).toHaveBeenCalled();
    expectStatus('dev-disabled', { currentVersion: buildVersion });
  });

  it('falls back to the build version when getVersion() returns empty', async () => {
    setIsDevBuildForTest(true);
    mockedGetVersion.mockResolvedValue('');
    await checkForUpdates();
    expect(mockedGetVersion).toHaveBeenCalled();
    expectStatus('dev-disabled', { currentVersion: buildVersion });
  });

  it('transitions to no-update when no update is available', async () => {
    setIsDevBuildForTest(false);
    mockedGetVersion.mockResolvedValue('0.2.0');
    mockedCheck.mockResolvedValue(null);
    await checkForUpdates();
    expect(mockedCheck).toHaveBeenCalledTimes(1);
    expectStatus('no-update', { currentVersion: '0.2.0', availableVersion: null });
  });

  it('transitions to available when an update is returned', async () => {
    setIsDevBuildForTest(false);
    mockedGetVersion.mockResolvedValue('0.2.0');
    mockedCheck.mockResolvedValue({ version: '0.3.0' } as UpdaterUpdate);
    await checkForUpdates();
    expectStatus('available', { currentVersion: '0.2.0', availableVersion: '0.3.0' });
  });

  it('sets error on network failures', async () => {
    setIsDevBuildForTest(false);
    mockedGetVersion.mockResolvedValue('0.2.0');
    mockedCheck.mockRejectedValue(new Error('Network request failed'));
    await checkForUpdates();
    const state = get(updateStatus);
    expect(state.status).toBe('error');
    expect(state.error).toContain('internet connection');
    expect(mockedShowToast).not.toHaveBeenCalled();
  });

  it('sets error on signature mismatch', async () => {
    setIsDevBuildForTest(false);
    mockedGetVersion.mockResolvedValue('0.2.0');
    mockedCheck.mockRejectedValue(new Error('invalid signature'));
    await checkForUpdates();
    const state = get(updateStatus);
    expect(state.status).toBe('error');
    expect(state.error).toContain('signature');
    expect(mockedShowToast).not.toHaveBeenCalled();
  });

  it('sets error on missing platform assets', async () => {
    setIsDevBuildForTest(false);
    mockedGetVersion.mockResolvedValue('0.2.0');
    mockedCheck.mockRejectedValue(new Error('no asset found for platform'));
    await checkForUpdates();
    const state = get(updateStatus);
    expect(state.status).toBe('error');
    expect(state.error).toContain('platform');
    expect(mockedShowToast).not.toHaveBeenCalled();
  });

  it('sets a clear error when the release endpoint is not found', async () => {
    setIsDevBuildForTest(false);
    mockedGetVersion.mockResolvedValue('0.2.0');
    mockedCheck.mockRejectedValue(new Error('404 Not Found: latest.json'));
    await checkForUpdates();
    const state = get(updateStatus);
    expect(state.status).toBe('error');
    expect(state.error).toContain('No published release');
    expect(mockedShowToast).not.toHaveBeenCalled();
  });

  it('stays idle on background check failures instead of opening the error modal', async () => {
    setIsDevBuildForTest(false);
    mockedGetVersion.mockResolvedValue('0.2.0');
    mockedCheck.mockRejectedValue(new Error('no asset found for platform'));
    await checkForUpdates({ background: true });
    expectStatus('idle', { currentVersion: '0.2.0', availableVersion: null, error: null });
    expect(mockedShowToast).not.toHaveBeenCalled();
  });

  it('still surfaces available updates for background checks', async () => {
    setIsDevBuildForTest(false);
    mockedGetVersion.mockResolvedValue('0.2.0');
    mockedCheck.mockResolvedValue({ version: '0.3.0' } as UpdaterUpdate);
    await checkForUpdates({ background: true });
    expectStatus('available', { currentVersion: '0.2.0', availableVersion: '0.3.0' });
  });

  it('still surfaces errors for manual checks (default options)', async () => {
    setIsDevBuildForTest(false);
    mockedGetVersion.mockResolvedValue('0.2.0');
    mockedCheck.mockRejectedValue(new Error('Network request failed'));
    await checkForUpdates();
    expectStatus('error');
    expect(get(updateStatus).error).toContain('internet connection');
  });
});

describe('dismissUpdatePanel', () => {
  it('clears an error state so the panel / modal can close', () => {
    updateStatus.setStatus('error', { error: 'Update check failed.', currentVersion: '0.2.0' });
    dismissUpdatePanel();
    expectStatus('idle', { error: null, availableVersion: null });
  });

  it('clears an available state', () => {
    updateStatus.setStatus('available', { availableVersion: '0.3.0', currentVersion: '0.2.0' });
    dismissUpdatePanel();
    expectStatus('idle');
  });

  it('does not interrupt an in-flight download or install', () => {
    updateStatus.setStatus('downloading', { availableVersion: '0.3.0', downloadProgress: 0.4 });
    dismissUpdatePanel();
    expectStatus('downloading', { downloadProgress: 0.4 });

    updateStatus.setStatus('installing', { availableVersion: '0.3.0', downloadProgress: 1 });
    dismissUpdatePanel();
    expectStatus('installing', { downloadProgress: 1 });
  });
});

describe('downloadAndInstallUpdate', () => {
  it('does nothing when status is not available', async () => {
    setIsDevBuildForTest(false);
    updateStatus.setStatus('idle');
    await downloadAndInstallUpdate();
    expect(mockedCheck).not.toHaveBeenCalled();
    expectStatus('idle');
  });

  it('transitions through downloading/installing and sets installed status on success', async () => {
    setIsDevBuildForTest(false);
    const download = vi.fn().mockImplementation((onEvent) => {
      onEvent({ event: 'Started', data: { contentLength: 100 } });
      onEvent({ event: 'Progress', data: { chunkLength: 25 } });
      onEvent({ event: 'Progress', data: { chunkLength: 25 } });
      onEvent({ event: 'Progress', data: { chunkLength: 25 } });
      onEvent({ event: 'Progress', data: { chunkLength: 25 } });
      onEvent({ event: 'Finished' });
      return Promise.resolve();
    });
    mockedCheck.mockResolvedValue({ version: '0.3.0', download, install: vi.fn().mockResolvedValue(undefined) } as unknown as UpdaterUpdate);

    updateStatus.setStatus('available', { availableVersion: '0.3.0' });
    await downloadAndInstallUpdate();

    const state = get(updateStatus);
    expect(state.status).toBe('installed');
    expect(state.downloadProgress).toBe(1);
    expect(download).toHaveBeenCalled();
  });

  it('persists the captured version before the installer can quit the process', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    setCurrentNpubForPersistence('alice');
    mockedGetVersion.mockResolvedValue('0.8.0');
    const install = vi.fn(async () => { expect(values.get('pacto_whats_new_seen_alice')).toBe('0.8.0'); });
    mockedCheck.mockResolvedValue({ version: '0.9.0', download: vi.fn().mockResolvedValue(undefined), install } as unknown as UpdaterUpdate);
    updateStatus.setStatus('available', { availableVersion: '0.9.0' });
    await downloadAndInstallUpdate();
    expect(install).toHaveBeenCalledOnce();
    expectStatus('installed');
  });

  it.each([null, '0.10.0'])('restores the previous marker %s when installation fails', async (previous) => {
    const key = 'pacto_whats_new_seen_alice';
    const values = new Map<string, string>(previous ? [[key, previous]] : []);
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    setCurrentNpubForPersistence('alice');
    mockedGetVersion.mockResolvedValue('0.8.0');
    const install = vi.fn().mockRejectedValue(new Error('network error'));
    mockedCheck.mockResolvedValue({ version: '0.9.0', download: vi.fn().mockResolvedValue(undefined), install } as unknown as UpdaterUpdate);
    updateStatus.setStatus('available', { availableVersion: '0.9.0' });
    await downloadAndInstallUpdate();
    expect(values.get(key) ?? null).toBe(previous);
    expectStatus('error');
    expect(mockedShowToast).not.toHaveBeenCalled();
  });

  it('does not roll back a newer origin operation after a failed installer', async () => {
    const key = 'pacto_whats_new_seen_alice';
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    setCurrentNpubForPersistence('alice');
    mockedGetVersion.mockResolvedValue('0.8.0');
    const install = vi.fn(async () => { rememberVersionBeforeUpdate('0.8.0'); throw new Error('failed'); });
    mockedCheck.mockResolvedValue({ version: '0.9.0', download: vi.fn().mockResolvedValue(undefined), install } as unknown as UpdaterUpdate);
    updateStatus.setStatus('available', { availableVersion: '0.9.0' });
    await downloadAndInstallUpdate();
    expect(values.get(key)).toBe('0.8.0');
  });

  it('does not enroll another account if it switches during download', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    setCurrentNpubForPersistence('alice');
    mockedGetVersion.mockResolvedValue('0.8.0');
    const download = vi.fn(async () => { setCurrentNpubForPersistence('bob'); });
    mockedCheck.mockResolvedValue({ version: '0.9.0', download, install: vi.fn().mockResolvedValue(undefined) } as unknown as UpdaterUpdate);
    updateStatus.setStatus('available', { availableVersion: '0.9.0' });
    await downloadAndInstallUpdate();
    expect(values.size).toBe(0);
  });

});

describe('relaunchApp', () => {
  it('records the old version before restarting after an installed update', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    setCurrentNpubForPersistence('alice');
    mockedGetVersion.mockResolvedValue('0.8.0');
    updateStatus.setStatus('installed');
    mockedInvoke.mockImplementation(async () => {
      expect(values.get('pacto_whats_new_seen_alice')).toBe('0.8.0');
    });
    await relaunchApp();
  });

  it('calls the backend relaunch command', async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await relaunchApp();
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith('relaunch_app');
  });
});

describe('build metadata', () => {
  it('exposes a build commit hash', () => {
    expect(typeof buildCommitHash).toBe('string');
    expect(buildCommitHash.length).toBeGreaterThan(0);
  });

  it('exposes a build version starting with v', () => {
    expect(typeof buildVersion).toBe('string');
    expect(buildVersion.startsWith('v')).toBe(true);
  });
});
