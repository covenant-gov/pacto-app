import { writable } from 'svelte/store';
import { persistenceKey, setCurrentNpubForPersistence } from './persistence-context';

export const STARTUP_CHECK_PREFIX = 'pacto_startup_check_enabled_v1';

export const startupCheckEnabled = writable<boolean>(false);

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
    startupCheckEnabled.set(false);
    return;
  }
  const key = persistenceKey(STARTUP_CHECK_PREFIX);
  if (!key) {
    startupCheckEnabled.set(false);
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      startupCheckEnabled.set(false);
      return;
    }
    const parsed = JSON.parse(raw);
    startupCheckEnabled.set(typeof parsed === 'boolean' ? parsed : false);
  } catch {
    startupCheckEnabled.set(false);
  }
}

startupCheckEnabled.subscribe((value) => {
  persistStartupCheckEnabled(value);
});
