import { writable } from 'svelte/store';
import { persistenceKey, setCurrentNpubForPersistence } from './persistence-context';

/** v2: courtesy startup check defaults on; v1 keys are ignored and cleared on logout. */
export const STARTUP_CHECK_PREFIX = 'pacto_startup_check_enabled_v2';

/** Prior key; kept in logout cleanup so stale v1 values do not linger. */
export const STARTUP_CHECK_PREFIX_V1 = 'pacto_startup_check_enabled_v1';

/** Check for updates after unlock. Default on; users may opt out. */
export const startupCheckEnabled = writable<boolean>(true);

let hasRunStartupCheckThisSession = false;

export function markStartupCheckRun(): void {
  hasRunStartupCheckThisSession = true;
}

export function getHasRunStartupCheckThisSession(): boolean {
  return hasRunStartupCheckThisSession;
}

/** Reset the per-session guard. Used by tests; app restart naturally resets it. */
export function resetStartupCheckSession(): void {
  hasRunStartupCheckThisSession = false;
}

function persistStartupCheckEnabled(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(STARTUP_CHECK_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function loadStartupCheckPreference(npub: string): void {
  setCurrentNpubForPersistence(npub);
  if (typeof localStorage === 'undefined') {
    startupCheckEnabled.set(true);
    return;
  }
  const key = persistenceKey(STARTUP_CHECK_PREFIX);
  if (!key) {
    startupCheckEnabled.set(true);
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      startupCheckEnabled.set(true);
      return;
    }
    const parsed = JSON.parse(raw);
    startupCheckEnabled.set(typeof parsed === 'boolean' ? parsed : true);
  } catch {
    startupCheckEnabled.set(true);
  }
}

startupCheckEnabled.subscribe((value) => {
  persistStartupCheckEnabled(value);
});
