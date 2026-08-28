import { get, writable } from 'svelte/store';
import { getTorStatus, setTorRoutingEnabled as applyTorRoutingEnabled } from '../lib/api/tor';
import { getInvokeErrorMessage } from '../lib/utils/tauri-errors';

/**
 * Mirrors the backend's live Tor routing state -- not the raw persisted
 * preference -- so any surface (settings toggle, top-navbar indicator) can
 * react to it live. A failed bootstrap leaves this `false` even when the
 * user's stored preference is "on"; see `torStartupError` and
 * `net_transport::apply_persisted_setting`.
 */
export const torRoutingEnabled = writable<boolean>(false);

/** False on builds without the `tor` feature (e.g. Android), where routing can never be enabled. */
export const torAvailable = writable<boolean>(true);

/**
 * Set when the persisted preference is on but the most recent bootstrap
 * attempt (at login or during the backend's automatic retry) failed,
 * explaining why `torRoutingEnabled` can read `false` despite the user
 * having turned the setting on. `null` once resolved.
 */
export const torStartupError = writable<string | null>(null);

/**
 * Hydrates the stores from the backend's live status. Errors are swallowed
 * (defaults to disabled) since this runs as a fire-and-forget global load on
 * login/account-switch; PrivacySettingsSection does its own load for
 * user-facing error messaging.
 */
export async function loadTorRoutingEnabled(): Promise<void> {
  try {
    const status = await getTorStatus();
    torRoutingEnabled.set(status.enabled);
    torAvailable.set(status.available);
    torStartupError.set(status.startup_error);
  } catch {
    torRoutingEnabled.set(false);
  }
}

/**
 * Serializes toggle calls across every surface sharing this store (the
 * Settings page and the nav-bar popover), so two concurrent toggles -- e.g.
 * a slow first enable still bootstrapping while the popover's disconnect
 * checkbox is clicked -- can't race the backend into a state that
 * disagrees with whichever UI update happens to land last.
 */
let pendingToggle: Promise<string | null> = Promise.resolve(null);

/**
 * Optimistically flips the shared store and persists the change via the
 * backend, reverting the store if the backend rejects. Shared by the
 * Settings toggle and the nav-bar popover's disconnect checkbox so neither
 * surface can drift out of sync with the other or with the backend.
 * Returns a user-facing error message on failure, `null` on success.
 */
export function toggleTorRouting(next: boolean, fallbackError: string): Promise<string | null> {
  const run = async (): Promise<string | null> => {
    const previous = get(torRoutingEnabled);
    torRoutingEnabled.set(next);
    try {
      await applyTorRoutingEnabled(next);
      torStartupError.set(null);
      return null;
    } catch (err) {
      torRoutingEnabled.set(previous);
      return getInvokeErrorMessage(err, fallbackError);
    }
  };
  pendingToggle = pendingToggle.catch(() => null).then(run);
  return pendingToggle;
}
