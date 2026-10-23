/**
 * Non-blocking network sync after account unlock / import.
 * Must not block PIN UI.
 */

import { get } from 'svelte/store';
import { listen, type UnlistenFn } from '../api';
import { connect as apiConnect } from '../api/auth';
import { monitorRelayConnections, type RelayStatus } from '../api/relays';
import { fetchMessages, refreshProfileNow, startNotifs, syncMlsGroupsNow } from '../api/nostr';
import { dmLog } from '../utils/dm-debug';
import { dmSyncStatus } from '../../stores/dm';
import { loadProfile } from '../../stores/profiles';
import { scheduleCommonsStartupPrefetch } from '../commons/commons-prefetch';
import { checkForUpdates } from '../updater/update-check';
import {
  startupCheckEnabled,
  markStartupCheckRun,
  getHasRunStartupCheckThisSession,
} from '../../stores/startup-check';
import { isDevBuild } from '../updater/update-check';

/** True once `runPostLoginNetworkSync` has been called this process; app restart resets it. */
export let hasRunPostLoginNetworkSyncThisSession = false;

/** Reset the per-process guard. Used by tests; app restart naturally resets it. */
export function resetPostLoginNetworkSyncSession(): void {
  hasRunPostLoginNetworkSyncThisSession = false;
}

export function runPostLoginNetworkSync(npub: string): void {
  // Set synchronously (not inside the async IIFE below) so a caller that checks this flag
  // right after triggering login — e.g. +page.svelte's onMount fallback — sees it before
  // its own mount logic runs, even though the actual sync work below is still in flight.
  hasRunPostLoginNetworkSyncThisSession = true;
  // Also set synchronously: wake-sync's focus/visibilitychange/resume listeners are
  // installed in the same onMount pass and only guard against a competing catch-up
  // fetch by checking dmSyncStatus. Setting this after `await apiConnect()` would leave
  // a gap where a wake event landing before the connect resolves slips past that guard.
  dmSyncStatus.set('syncing');
  scheduleCommonsStartupPrefetch();
  void (async () => {
    try {
      dmLog('post-login: connect()');
      await apiConnect();
      dmLog('post-login: connect() done');
    } catch (e) {
      console.error('connect after login failed:', e);
    }

    monitorRelayConnections().catch((e) => console.error('monitor_relay_connections failed:', e));

    // Live relay subscriptions are started here, not from the backend's `init_finished`
    // event: that event can be emitted before the frontend listener is registered on a
    // warm start, which left the session with no live DM/MLS/Commons delivery at all.
    // `notifs` is idempotent per login, so a repeat call is a no-op.
    dmLog('post-login: startNotifs()');
    void startNotifsWithRetry();

    // Own Kind 0 starts before the message backfill: after a seed import it is what
    // turns Anonymous back into the user's name/avatar. Settings shows it as restoring.
    dmLog('post-login: loadProfile(own)');
    const ownProfileLoad = loadProfile(npub).catch((e) =>
      console.error('Own profile hydrate failed:', e)
    );

    dmLog('post-login: fetchMessages(true)');
    fetchMessages(true).catch((e) => console.error('fetch_messages failed:', e));

    await ownProfileLoad;

    try {
      await refreshProfileNow(npub);
    } catch (e) {
      console.error('Auto profile refresh failed:', e);
    }

    syncMlsGroupsNow(null).catch((e) => console.error('syncMlsGroupsNow after login failed:', e));
    dmLog('post-login: network sync done');

    runStartupUpdateCheckIfEnabled();
  })();
}

/**
 * Start live subscriptions, retrying on relay connect if the first attempt fails.
 *
 * `startNotifs` can fail transiently during startup: the backend's bounded wait for a
 * populated relay pool can expire, or a `subscribe` call can fail while relays are still
 * coming up. The backend releases its per-login claim on that failure, and the old
 * `init_finished` path that used to start subscriptions later has been removed — so without
 * a retry the logged-in session is left with no live DM/MLS/Commons delivery. Retry whenever
 * a relay reaches `connected` (the signal the pool has gained a relay to subscribe on). The
 * backend's `notifs` is idempotent per login, so re-calling after a success is a no-op.
 */
async function startNotifsWithRetry(): Promise<void> {
  try {
    await startNotifs();
    return;
  } catch (e) {
    console.error('notifs failed:', e);
  }

  let settled = false;
  let retrying = false;
  // The callback runs only on later events, by which point `unlisten` is assigned.
  const unlisten: UnlistenFn = await listen<{ url: string; status: RelayStatus }>(
    'relay_status_change',
    async (event) => {
      // Only a relay reaching `connected` means there is now something to subscribe on.
      // Guard against overlapping retries and against retrying once one has succeeded.
      if (settled || retrying || event.payload.status !== 'connected') return;
      retrying = true;
      try {
        await startNotifs();
        settled = true;
        unlisten();
      } catch (e) {
        console.error('notifs retry failed:', e);
      } finally {
        retrying = false;
      }
    }
  );
}

function runStartupUpdateCheckIfEnabled(): void {
  if (isDevBuild()) return;
  if (getHasRunStartupCheckThisSession()) return;
  if (!get(startupCheckEnabled)) return;

  markStartupCheckRun();
  void checkForUpdates();
}
