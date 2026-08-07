import { get, writable } from 'svelte/store';
import {
  getCatchUpCount,
  listCatchUpEntries,
  resolveAllCatchUpEntries,
  resolveCatchUpEntry,
  type CatchUpEntry,
} from '../lib/api/catch-up';
import { getInvokeErrorMessage } from '../lib/utils/tauri-errors';
import type { Squad } from './squads';

export interface CatchUpFilter {
  kind?: string;
  squadId?: string;
}

/** Unresolved entries for the active filter, newest first. */
export const catchUpEntries = writable<CatchUpEntry[]>([]);

/**
 * Unresolved count excluding chats at Nothing (R24) — filter-independent,
 * the same authority every other badge reads (R14). Hydrated separately
 * from the entry list so a tab badge can show it before Catch up itself is
 * ever opened.
 */
export const catchUpCount = writable<number>(0);

export const catchUpLoading = writable<boolean>(false);
export const catchUpError = writable<string>('');
export const catchUpFilter = writable<CatchUpFilter>({});

let hydrateGen = 0;

/** Lightweight init-time hydrate for the tab badge, before Catch up opens. */
export async function hydrateCatchUpCount(): Promise<void> {
  try {
    catchUpCount.set(await getCatchUpCount());
  } catch {
    // best-effort; opening Catch up will retry via hydrateCatchUp
  }
}

/** Loads entries for the current filter, plus a fresh count. */
export async function hydrateCatchUp(): Promise<void> {
  const gen = ++hydrateGen;
  catchUpLoading.set(true);
  catchUpError.set('');
  const { kind, squadId } = get(catchUpFilter);
  try {
    const [entries, count] = await Promise.all([listCatchUpEntries(kind, squadId), getCatchUpCount()]);
    if (gen !== hydrateGen) return; // superseded by a newer hydrate
    catchUpEntries.set(entries);
    catchUpCount.set(count);
  } catch (e) {
    if (gen !== hydrateGen) return;
    catchUpError.set(getInvokeErrorMessage(e, 'Could not load Catch up.'));
  } finally {
    if (gen === hydrateGen) catchUpLoading.set(false);
  }
}

/** Changes the active filter (needs-action, mentions, or one squad) and reloads. */
export function setCatchUpFilter(filter: CatchUpFilter): void {
  catchUpFilter.set(filter);
  void hydrateCatchUp();
}

/** Clears one entry (R23's "individually") and refreshes the count. */
export async function resolveOneCatchUpEntry(sourceEventId: string): Promise<void> {
  await resolveCatchUpEntry(sourceEventId);
  catchUpEntries.update((list) => list.filter((e) => e.sourceEventId !== sourceEventId));
  await hydrateCatchUpCount();
}

/** Resolves exactly the currently-filtered entries (R23's mark-all-read). */
export async function markAllCatchUpRead(): Promise<void> {
  const { kind, squadId } = get(catchUpFilter);
  await resolveAllCatchUpEntries(kind, squadId);
  catchUpEntries.set([]);
  await hydrateCatchUpCount();
}

export function resetCatchUpStore(): void {
  hydrateGen++;
  catchUpEntries.set([]);
  catchUpCount.set(0);
  catchUpLoading.set(false);
  catchUpError.set('');
  catchUpFilter.set({});
}

export interface CatchUpGroup {
  /** Squad id, or `'dms'` for the DM/invite group. */
  key: string;
  label: string | null;
  entries: CatchUpEntry[];
}

/**
 * Groups entries by the squad owning their chat id, DM/invite entries in
 * their own group (Approach #5). Entries are assumed already newest-first
 * (the backend's ordering); groups form in first-encountered order, so the
 * group holding the most recent entry appears first too — no separate
 * group sort is needed to keep the surface newest-first overall.
 */
export function groupCatchUpEntriesBySquad(entries: CatchUpEntry[], allSquads: Squad[]): CatchUpGroup[] {
  const groups = new Map<string, CatchUpGroup>();
  for (const entry of entries) {
    const squad = allSquads.find((s) => s.channels.some((c) => c.groupId === entry.chatId));
    const key = squad?.id ?? 'dms';
    let group = groups.get(key);
    if (!group) {
      group = { key, label: squad?.name ?? null, entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()];
}
