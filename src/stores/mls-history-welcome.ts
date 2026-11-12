/**
 * Local-only welcome note. Key is group id → accept time. A v1 id list loads empty.
 */

import { derived, get, writable } from 'svelte/store';
import { persistenceKey } from './persistence-context';

export const MLS_HISTORY_WELCOME_PREFIX = 'mls_history_welcome_v2';

/** Lowercase group id → Unix ms when the welcome was marked. */
export const mlsHistoryWelcomeAcceptedAt = writable<Record<string, number>>({});

/** Group ids that should show the welcome note. */
export const mlsHistoryWelcomeGroupIds = derived(mlsHistoryWelcomeAcceptedAt, (acceptedAt) =>
  Object.keys(acceptedAt)
);

function normalizeGroupId(groupId: string): string {
  return groupId.trim().toLowerCase();
}

function persist(acceptedAt: Record<string, number>): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(MLS_HISTORY_WELCOME_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(acceptedAt));
  } catch {
    /* ignore quota */
  }
}

function publish(acceptedAt: Record<string, number>): void {
  mlsHistoryWelcomeAcceptedAt.set(acceptedAt);
  persist(acceptedAt);
}

export function loadMlsHistoryWelcome(npub: string): void {
  if (typeof localStorage === 'undefined' || !npub) {
    publish({});
    return;
  }
  try {
    const raw = localStorage.getItem(`${MLS_HISTORY_WELCOME_PREFIX}_${npub}`);
    if (!raw) {
      publish({});
      return;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      publish({});
      return;
    }
    const acceptedAt: Record<string, number> = {};
    for (const [groupId, at] of Object.entries(parsed)) {
      const id = normalizeGroupId(groupId);
      if (!id || typeof at !== 'number' || !Number.isFinite(at)) continue;
      acceptedAt[id] = at;
    }
    publish(acceptedAt);
  } catch {
    publish({});
  }
}

/** Record the first accept time for this group. Later marks keep that time. */
export function markMlsHistoryWelcome(groupId: string, acceptedAtMs = Date.now()): void {
  const id = normalizeGroupId(groupId);
  if (!id) return;
  const current = get(mlsHistoryWelcomeAcceptedAt);
  if (current[id] != null) return;
  publish({ ...current, [id]: acceptedAtMs });
}

export function clearMlsHistoryWelcome(): void {
  publish({});
}

export function resetMlsHistoryWelcomeForTests(): void {
  clearMlsHistoryWelcome();
}

export function shouldShowMlsHistoryWelcome(groupId: string): boolean {
  const id = normalizeGroupId(groupId);
  return id !== '' && get(mlsHistoryWelcomeGroupIds).includes(id);
}
