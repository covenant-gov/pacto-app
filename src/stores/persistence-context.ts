import { writable, get } from 'svelte/store';

/** Current npub for persistence: scoped localStorage keys use this. Set on login, cleared on logout. */
export const currentNpubForPersistence = writable<string | null>(null);

export function setCurrentNpubForPersistence(npub: string | null): void {
  currentNpubForPersistence.set(npub);
}

export function persistenceKey(prefix: string): string | null {
  const npub = get(currentNpubForPersistence);
  return npub ? `${prefix}_${npub}` : null;
}
