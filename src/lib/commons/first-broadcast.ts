/**
 * Tracks whether an account has ever published a user broadcast. The first
 * broadcast ever is tagged `#new` and shown as a new user; every later one is
 * an active user. Persisted per npub (not cleared on logout) and intentionally
 * coarse — cancelling the first broadcast does not reset this.
 */
export const PACTO_COMMONS_BROADCASTED_PREFIX = 'pacto_commons_broadcasted';

function key(npub: string): string {
  return `${PACTO_COMMONS_BROADCASTED_PREFIX}_${npub}`;
}

export function hasEverBroadcast(npub: string): boolean {
  if (typeof localStorage === 'undefined' || !npub) return false;
  try {
    return localStorage.getItem(key(npub)) === '1';
  } catch {
    return false;
  }
}

export function markHasEverBroadcast(npub: string): void {
  if (typeof localStorage === 'undefined' || !npub) return;
  try {
    localStorage.setItem(key(npub), '1');
  } catch {
    // ignore quota
  }
}
