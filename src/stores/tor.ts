import { get, writable } from 'svelte/store';
import { getSqlSetting } from '../lib/api/settings';
import { setTorRoutingEnabled as applyTorRoutingEnabled } from '../lib/api/tor';
import { getInvokeErrorMessage } from '../lib/utils/tauri-errors';

export const TOR_SETTING_KEY = 'route_traffic_through_tor';

/** Mirrors the persisted "Route Traffic Through Tor" setting so any surface
 *  (settings toggle, top-navbar indicator) can react to it live. */
export const torRoutingEnabled = writable<boolean>(false);

/**
 * Hydrates the store from the persisted per-account setting. Errors are
 * swallowed (defaults to disabled) since this runs as a fire-and-forget
 * global load on login/account-switch; PrivacySettingsSection does its own
 * load for user-facing error messaging.
 */
export async function loadTorRoutingEnabled(): Promise<void> {
  try {
    const value = await getSqlSetting(TOR_SETTING_KEY);
    torRoutingEnabled.set(value === 'true');
  } catch {
    torRoutingEnabled.set(false);
  }
}

/**
 * Optimistically flips the shared store and persists the change via the
 * backend, reverting the store if the backend rejects. Shared by the
 * Settings toggle and the nav-bar popover's disconnect checkbox so neither
 * surface can drift out of sync with the other or with the backend.
 * Returns a user-facing error message on failure, `null` on success.
 */
export async function toggleTorRouting(next: boolean, fallbackError: string): Promise<string | null> {
  const previous = get(torRoutingEnabled);
  torRoutingEnabled.set(next);
  try {
    await applyTorRoutingEnabled(next);
    return null;
  } catch (err) {
    torRoutingEnabled.set(previous);
    return getInvokeErrorMessage(err, fallbackError);
  }
}
