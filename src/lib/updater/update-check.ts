import { check, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { writable, get, type Readable } from 'svelte/store';



declare const __APP_COMMIT_HASH__: string | undefined;
declare const __APP_VERSION__: string | undefined;

export let isDevBuild = (): boolean => import.meta.env.DEV;

/** Git commit hash the bundle was built from, or 'unknown'. */
export const buildCommitHash: string = typeof __APP_COMMIT_HASH__ === 'string' ? __APP_COMMIT_HASH__ : 'unknown';

/** Package version the bundle was built from (e.g. v0.2.0), or 'v0.0.0'. */
export const buildVersion: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'v0.0.0';

/** Resolve the installed version, falling back to the package version. */
export async function resolveInstalledVersion(): Promise<string> {
  const installed = await getVersion().catch(() => '');
  // Tauri returns '0.0.0' when it cannot read a real bundle version.
  return installed && installed !== '0.0.0' ? installed : buildVersion;
}

/** Test-only hook to override the dev-build detector. */
export function setIsDevBuildForTest(value: boolean): void {
  isDevBuild = () => value;
}

export type UpdaterUpdate = Awaited<ReturnType<typeof check>>;

let memoizedCheckPromise: Promise<UpdaterUpdate> | null = null;

/**
 * The launch-time manifest check, called at most once per launch. Both the
 * update gate and `checkForUpdates` consult this instead of calling
 * `check()` directly, so one launch makes one round trip and the courtesy
 * startup check can never race a second, independent result into
 * `updateStatus`. Dev builds resolve `null` without a network call, since
 * `check()` has no manifest to read in dev.
 */
export function getMemoizedUpdateCheck(): Promise<UpdaterUpdate> {
  if (!memoizedCheckPromise) {
    memoizedCheckPromise = isDevBuild() ? Promise.resolve(null) : check();
  }
  return memoizedCheckPromise;
}

/** Test-only: force the next call to make a fresh `check()` call. */
export function resetMemoizedUpdateCheckForTest(): void {
  memoizedCheckPromise = null;
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'no-update'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'installed'
  | 'error'
  | 'dev-disabled';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  downloadProgress: number;
  error: string | null;
}

const initialState: UpdateState = {
  status: 'idle',
  currentVersion: buildVersion,
  availableVersion: null,
  downloadProgress: 0,
  error: null,
};

function createUpdateStatusStore() {
  const { subscribe, set, update } = writable<UpdateState>(initialState);

  return {
    subscribe,
    set,
    update,
    reset: () => set(initialState),
    setStatus: (status: UpdateStatus, patch: Partial<UpdateState> = {}) =>
      set({
        ...get(updateStatus),
        status,
        error: status === 'error' ? get(updateStatus).error : null,
        // Clear stale download state when leaving download/install phases.
        downloadProgress: status === 'downloading' || status === 'installing'
          ? get(updateStatus).downloadProgress
          : 0,
        ...patch,
      }),
  };
}

export const updateStatus = createUpdateStatusStore();

export function resetUpdateStatus(): void {
  updateStatus.reset();
}

function friendlyErrorMessage(err: unknown): string {
  const rawMessage = err instanceof Error ? err.message : String(err ?? '');
  const msg = rawMessage.toLowerCase();

  if (msg.includes('network') || msg.includes('fetch') || msg.includes('offline') || msg.includes('connection')) {
    return 'Update check failed. Please check your internet connection and try again.';
  }
  if (msg.includes('signature') || msg.includes('verify') || msg.includes('invalid signature')) {
    return 'Update signature mismatch. The update package could not be verified.';
  }
  if (msg.includes('platform') || msg.includes('asset') || msg.includes('no asset')) {
    return 'No update is available for this platform yet.';
  }
  if (
    msg.includes('not found') ||
    msg.includes('404') ||
    msg.includes('latest.json') ||
    msg.includes('no release') ||
    msg.includes('unexpected http response')
  ) {
    return 'No published release was found. This is expected until the first release is shipped.';
  }
  if (msg.includes('timeout')) {
    return 'Update check timed out. Please try again.';
  }

  return rawMessage || 'Update check failed.';
}

export async function checkForUpdates(): Promise<void> {
  const currentVersion = await resolveInstalledVersion();

  if (isDevBuild()) {
    updateStatus.setStatus('dev-disabled', { currentVersion });
    return;
  }

  updateStatus.setStatus('checking', { currentVersion, availableVersion: null, error: null });

  try {
    const update = await getMemoizedUpdateCheck();
    if (!update) {
      updateStatus.setStatus('no-update', { currentVersion });
      return;
    }

    updateStatus.setStatus('available', {
      currentVersion,
      availableVersion: update.version,
      downloadProgress: 0,
    });
  } catch (err) {
    console.error('[updater] Update check failed:', err);
    const message = friendlyErrorMessage(err);
    updateStatus.setStatus('error', { error: message });
  }
}

/**
 * Force a fresh manifest check, bypassing the per-launch memo. For an
 * explicit user-initiated retry (e.g. the update gate's block screen),
 * where a second network attempt is a deliberate choice rather than
 * passive launch-time behavior.
 */
export function retryUpdateCheck(): Promise<void> {
  memoizedCheckPromise = null;
  return checkForUpdates();
}

let downloadTotalBytes = 0;
let downloadedBytes = 0;

function resetDownloadProgress(): void {
  downloadTotalBytes = 0;
  downloadedBytes = 0;
}

function getDownloadProgress(): number {
  if (!downloadTotalBytes) return 0;
  return Math.min(1, downloadedBytes / downloadTotalBytes);
}

function handleDownloadEvent(event: DownloadEvent): void {
  if (event.event === 'Started') {
    resetDownloadProgress();
    downloadTotalBytes = event.data.contentLength ?? 0;
    updateStatus.setStatus('downloading', { downloadProgress: 0 });
  } else if (event.event === 'Progress') {
    downloadedBytes += event.data.chunkLength;
    updateStatus.setStatus('downloading', { downloadProgress: getDownloadProgress() });
  } else if (event.event === 'Finished') {
    updateStatus.setStatus('installing', { downloadProgress: 1 });
  }
}

export async function downloadAndInstallUpdate(): Promise<void> {
  const state = get(updateStatus);
  if (state.status !== 'available') return;

  resetDownloadProgress();

  try {
    const update = await check();
    if (!update) {
      updateStatus.setStatus('no-update');
      return;
    }

    await update.downloadAndInstall((event) => handleDownloadEvent(event));
    updateStatus.setStatus('installed', { downloadProgress: 1 });
  } catch (err) {
    console.error('[updater] Download or install failed:', err);
    const message = friendlyErrorMessage(err);
    updateStatus.setStatus('error', { error: message, availableVersion: null });
  }
}

export async function relaunchApp(): Promise<void> {
  // Use the backend restart command: it runs cleanup and then spawns the
  // new process directly, avoiding the macOS event-loop race described in
  // https://github.com/tauri-apps/tauri/issues/11392.
  await invoke<void>('relaunch_app');
}

/** Readable alias for components that only need to subscribe. */
export const updateStatusReadable: Readable<UpdateState> = updateStatus;
