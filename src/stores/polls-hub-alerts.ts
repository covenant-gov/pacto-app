import { get, writable } from 'svelte/store';
import { listDashboardPolls, type DashboardPollDto } from '../lib/api/nostr';
import { currentUser } from './auth-session';
import { persistenceKey, setCurrentNpubForPersistence } from './persistence-context';

export const LAST_SEEN_POLL_CREATED_AT_PREFIX = 'pacto_last_seen_poll_created_at_v1';

/** Per-parent `#polls` watermark: the first-seen baseline, then the newest create the user has seen. */
export const lastSeenPollCreatedAtMsByParentId = writable<Record<string, number>>({});

/** Sidebar badge counts for `#polls` (unseen creates by others). */
export const unseenPollCreateCountByParentId = writable<Record<string, number>>({});

const refreshGenByParentId = new Map<string, number>();
const seenGenByParentId = new Map<string, number>();
const refreshInFlight = new Set<string>();
const refreshRerun = new Set<string>();

export function resetPollsHubAlertStores(): void {
  lastSeenPollCreatedAtMsByParentId.set({});
  unseenPollCreateCountByParentId.set({});
  refreshGenByParentId.clear();
  seenGenByParentId.clear();
  refreshInFlight.clear();
  refreshRerun.clear();
}

function persistWatermarks(map: Record<string, number>): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_SEEN_POLL_CREATED_AT_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function loadLastSeenPollCreatedAt(npub: string): void {
  setCurrentNpubForPersistence(npub);
  if (typeof localStorage === 'undefined') {
    lastSeenPollCreatedAtMsByParentId.set({});
    return;
  }
  const key = persistenceKey(LAST_SEEN_POLL_CREATED_AT_PREFIX);
  if (!key) {
    lastSeenPollCreatedAtMsByParentId.set({});
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      lastSeenPollCreatedAtMsByParentId.set({});
      return;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      lastSeenPollCreatedAtMsByParentId.set({});
      return;
    }
    const out: Record<string, number> = {};
    for (const [pid, ms] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) out[pid] = ms;
    }
    lastSeenPollCreatedAtMsByParentId.set(out);
  } catch {
    lastSeenPollCreatedAtMsByParentId.set({});
  }
}

/** First sight of a parent fixes its baseline so polls created later badge, across restarts. */
function ensureBaseline(pid: string): number {
  const map = get(lastSeenPollCreatedAtMsByParentId);
  if (Object.prototype.hasOwnProperty.call(map, pid)) return map[pid] ?? 0;
  const baseline = Date.now();
  const next = { ...map, [pid]: baseline };
  lastSeenPollCreatedAtMsByParentId.set(next);
  persistWatermarks(next);
  return baseline;
}

/** Pure count helper for tests. */
export function countUnseenPollCreates(
  polls: DashboardPollDto[],
  watermarkMs: number,
  currentNpub: string | null | undefined
): number {
  const me = currentNpub?.trim() ?? '';
  let n = 0;
  for (const p of polls) {
    if (p.created_at_ms <= watermarkMs) continue;
    if (me && p.created_by_npub.trim() === me) continue;
    n += 1;
  }
  return n;
}

/** Recount unseen creates; overlapping calls for a parent coalesce into one trailing refetch. */
export async function refreshUnseenPollCreatesForParent(parentId: string): Promise<void> {
  const pid = parentId.trim();
  if (!pid) return;
  if (refreshInFlight.has(pid)) {
    refreshRerun.add(pid);
    return;
  }
  refreshInFlight.add(pid);
  try {
    do {
      refreshRerun.delete(pid);
      await refreshOnce(pid);
    } while (refreshRerun.has(pid));
  } finally {
    refreshInFlight.delete(pid);
  }
}

async function refreshOnce(pid: string): Promise<void> {
  const watermark = ensureBaseline(pid);
  const gen = (refreshGenByParentId.get(pid) ?? 0) + 1;
  refreshGenByParentId.set(pid, gen);
  let polls: DashboardPollDto[];
  try {
    polls = await listDashboardPolls(pid);
  } catch {
    return;
  }
  if (refreshGenByParentId.get(pid) !== gen) return;
  const current = get(lastSeenPollCreatedAtMsByParentId)[pid] ?? watermark;
  const count = countUnseenPollCreates(polls, current, get(currentUser)?.npub);
  unseenPollCreateCountByParentId.update((m) => ({ ...m, [pid]: count }));
}

/**
 * Record what the user has seen in `#polls`. Only a newer `markPollsChannelSeen` can cancel
 * this: a refresh racing it must not swallow the watermark the user just earned.
 */
export async function markPollsChannelSeen(parentId: string): Promise<void> {
  const pid = parentId.trim();
  if (!pid) return;
  const seenGen = (seenGenByParentId.get(pid) ?? 0) + 1;
  seenGenByParentId.set(pid, seenGen);
  refreshGenByParentId.set(pid, (refreshGenByParentId.get(pid) ?? 0) + 1);
  let polls: DashboardPollDto[] = [];
  try {
    polls = await listDashboardPolls(pid);
  } catch {
    // still clear badge / bump watermark with wall clock
  }
  if (seenGenByParentId.get(pid) !== seenGen) return;
  // Invalidate refreshes that started while we were fetching; their count predates this watermark.
  refreshGenByParentId.set(pid, (refreshGenByParentId.get(pid) ?? 0) + 1);
  const maxCreated = polls.reduce((max, p) => Math.max(max, p.created_at_ms), 0);
  const seen = maxCreated > 0 ? maxCreated : Date.now();
  lastSeenPollCreatedAtMsByParentId.update((m) => {
    const next = { ...m, [pid]: Math.max(m[pid] ?? 0, seen) };
    persistWatermarks(next);
    return next;
  });
  unseenPollCreateCountByParentId.update((m) => ({ ...m, [pid]: 0 }));
}
