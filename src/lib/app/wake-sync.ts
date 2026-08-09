import { get } from 'svelte/store';
import { fetchMessages, syncMlsGroupsNow } from '../api/nostr';
import { dmError, dmLog } from '../utils/dm-debug';
import { dmSyncStatus } from '../../stores/dm';

/** Timer handle returned by setTimeout; alias keeps the variable type local. */
type TimerHandle = ReturnType<typeof setTimeout>;

const FOCUS_CHECK_DEBOUNCE_MS = 50;

let wakeSyncTimer: TimerHandle | null = null;
let wakeSyncCleanup: (() => void) | null = null;
let wakeSyncListenersInstalled = false;
let mlsWakeInFlight: Promise<unknown> | null = null;

/**
 * Ask the backend to fill any gap since the last sync. The backend (CatchUp
 * sync mode) decides whether there is actually anything to fetch; the
 * frontend never picks windows or relay queries itself.
 */
export function requestCatchUp(): void {
  dmLog('wake-sync → fetchMessages(false)');
  fetchMessages(false).catch((e) => {
    dmError('wake-sync: fetchMessages(false) failed', e);
  });
}

/** MLS wake catch-up; coalesces overlapping invokes while one is in flight. */
function requestMlsCatchUp(): void {
  if (mlsWakeInFlight) return;
  dmLog('wake-sync → syncMlsGroupsNow(null)');
  mlsWakeInFlight = syncMlsGroupsNow(null)
    .catch((e) => {
      dmError('wake-sync: syncMlsGroupsNow failed', e);
    })
    .finally(() => {
      mlsWakeInFlight = null;
    });
}

function debouncedRequestCatchUp(): void {
  if (wakeSyncTimer !== null) {
    clearTimeout(wakeSyncTimer);
    wakeSyncTimer = null;
  }
  wakeSyncTimer = globalThis.setTimeout(() => {
    wakeSyncTimer = null;
    // MLS is independent of GiftWrap dmSyncStatus (grace-period no-ops need it).
    requestMlsCatchUp();
    if (get(dmSyncStatus) === 'syncing') return;
    requestCatchUp();
  }, FOCUS_CHECK_DEBOUNCE_MS);
}

/**
 * Register listeners that trigger a debounced catch-up request whenever the
 * app regains focus, becomes visible, or resumes from sleep. Returns a
 * cleanup function that removes the listeners and any pending timer.
 */
export function installWakeSyncHandlers(): () => void {
  if (wakeSyncListenersInstalled) {
    return wakeSyncCleanup ?? (() => {});
  }

  wakeSyncListenersInstalled = true;

  const onFocus = () => debouncedRequestCatchUp();
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      debouncedRequestCatchUp();
    }
  };
  // Tauri/webview lifecycle event; not part of the standard DOM lib event
  // map, and has limited real-world browser/webview support, so it's a
  // defensive no-op where the runtime never fires it.
  const onResume = () => debouncedRequestCatchUp();

  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('resume', onResume as EventListener);

  wakeSyncCleanup = () => {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('resume', onResume as EventListener);
    wakeSyncListenersInstalled = false;
    if (wakeSyncTimer !== null) {
      clearTimeout(wakeSyncTimer);
      wakeSyncTimer = null;
    }
  };

  return wakeSyncCleanup;
}
