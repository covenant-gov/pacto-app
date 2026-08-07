import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { getVersion } from '@tauri-apps/api/app';
import {
  checkForUpdates,
  downloadAndInstallUpdate,
  relaunchApp,
  updateStatus,
  resetUpdateStatus,
  setIsDevBuildForTest,
  buildCommitHash,
  buildVersion,
  type UpdateState,
  type UpdaterUpdate,
} from './update-check';

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
  resetUpdateStatus();
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
    const downloadAndInstall = vi.fn().mockImplementation((onEvent) => {
      onEvent({ event: 'Started', data: { contentLength: 100 } });
      onEvent({ event: 'Progress', data: { chunkLength: 25 } });
      onEvent({ event: 'Progress', data: { chunkLength: 25 } });
      onEvent({ event: 'Progress', data: { chunkLength: 25 } });
      onEvent({ event: 'Progress', data: { chunkLength: 25 } });
      onEvent({ event: 'Finished' });
      return Promise.resolve();
    });
    mockedCheck.mockResolvedValue({ version: '0.3.0', downloadAndInstall } as unknown as UpdaterUpdate);

    updateStatus.setStatus('available', { availableVersion: '0.3.0' });
    await downloadAndInstallUpdate();

    const state = get(updateStatus);
    expect(state.status).toBe('installed');
    expect(state.downloadProgress).toBe(1);
    expect(downloadAndInstall).toHaveBeenCalled();
  });

  it('sets error when install fails', async () => {
    setIsDevBuildForTest(false);
    const downloadAndInstall = vi.fn().mockRejectedValue(new Error('network error'));
    mockedCheck.mockResolvedValue({ version: '0.3.0', downloadAndInstall } as unknown as UpdaterUpdate);

    updateStatus.setStatus('available', { availableVersion: '0.3.0' });
    await downloadAndInstallUpdate();

    const state = get(updateStatus);
    expect(state.status).toBe('error');
    expect(state.error).toContain('internet connection');
    expect(mockedShowToast).not.toHaveBeenCalled();
  });
});

describe('relaunchApp', () => {
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
