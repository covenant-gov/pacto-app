/**
 * Auth session atoms only — no login/logout side effects.
 * Import from here when you need `currentUser` / `isAuthenticated` without
 * pulling `auth.ts` (which would cycle through persistence / shell / invites).
 */
import { writable, derived } from 'svelte/store';

export interface CurrentUser {
  npub: string;
  pubkey: string;
}

export const isAuthenticated = writable<boolean>(false);
export const authLoading = writable<boolean>(false);
export const authError = writable<string | null>(null);
export const currentUser = writable<CurrentUser | null>(null);

export const isLoggedIn = derived(
  [isAuthenticated, currentUser],
  ([$isAuthenticated, $currentUser]) => $isAuthenticated && $currentUser !== null,
);
