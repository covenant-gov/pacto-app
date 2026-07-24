/**
 * Local-only “MLS history begins here” notice for channels joined via welcome.
 */

import { get, writable } from 'svelte/store';
import { persistenceKey } from './persistence-context';

export const MLS_HISTORY_WELCOME_PREFIX = 'mls_history_welcome_v1';

export const mlsHistoryWelcomeGroupIds = writable<string[]>([]);

function normalizeGroupId(groupId: string): string {
  return groupId.trim().toLowerCase();
}

function persist(ids: string[]): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(MLS_HISTORY_WELCOME_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

mlsHistoryWelcomeGroupIds.subscribe((ids) => {
  persist(ids);
});

/** Idempotent: remember that this device joined the group via MLS welcome. */
export function markMlsHistoryWelcome(groupId: string): void {
  const id = normalizeGroupId(groupId);
  if (!id) return;
  mlsHistoryWelcomeGroupIds.update((ids) => (ids.includes(id) ? ids : [...ids, id]));
}

export function shouldShowMlsHistoryWelcome(groupId: string | null | undefined): boolean {
  const id = typeof groupId === 'string' ? normalizeGroupId(groupId) : '';
  if (!id) return false;
  return get(mlsHistoryWelcomeGroupIds).includes(id);
}

export function loadMlsHistoryWelcome(npub: string): void {
  if (typeof localStorage === 'undefined') {
    mlsHistoryWelcomeGroupIds.set([]);
    return;
  }
  try {
    const raw = localStorage.getItem(`${MLS_HISTORY_WELCOME_PREFIX}_${npub}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const ids = Array.isArray(parsed)
      ? (parsed as string[])
          .filter((x) => typeof x === 'string' && x.trim())
          .map((x) => normalizeGroupId(x))
      : [];
    mlsHistoryWelcomeGroupIds.set([...new Set(ids)]);
  } catch {
    mlsHistoryWelcomeGroupIds.set([]);
  }
}

export function resetMlsHistoryWelcomeForTests(): void {
  mlsHistoryWelcomeGroupIds.set([]);
}
