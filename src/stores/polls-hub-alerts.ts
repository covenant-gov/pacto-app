import { get, writable } from 'svelte/store';
import { listDashboardPolls, type DashboardPollDto } from '../lib/api/nostr';
import { currentUser } from './auth-session';
import { persistenceKey, setCurrentNpubForPersistence } from './persistence-context';

export const LAST_SEEN_POLL_CREATED_AT_PREFIX = 'pacto_last_seen_poll_created_at_v1';

/** Per-parent last time the user opened `#polls` (max create timestamp seen). */
export const lastSeenPollCreatedAtMsByParentId = writable<Record<string, number>>({});

/** Sidebar badge counts for `#polls` (unseen creates by others). */
export const unseenPollCreateCountByParentId = writable<Record<string, number>>({});

/** Session fallback when a parent has no persisted watermark yet. */
let sessionDefaultWatermarkMs = 0;

const refreshGenByParentId = new Map<string, number>();

export function resetPollsHubAlertStores(): void {
  lastSeenPollCreatedAtMsByParentId.set({});
  unseenPollCreateCountByParentId.set({});
  sessionDefaultWatermarkMs = 0;
  refreshGenByParentId.clear();
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
  sessionDefaultWatermarkMs = Date.now();
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

export function effectivePollsWatermarkMs(parentId: string): number {
  const pid = parentId.trim();
  if (!pid) return sessionDefaultWatermarkMs;
  const map = get(lastSeenPollCreatedAtMsByParentId);
  if (Object.prototype.hasOwnProperty.call(map, pid)) return map[pid] ?? 0;
  return sessionDefaultWatermarkMs;
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

export async function refreshUnseenPollCreatesForParent(parentId: string): Promise<void> {
  const pid = parentId.trim();
  if (!pid) return;
  const gen = (refreshGenByParentId.get(pid) ?? 0) + 1;
  refreshGenByParentId.set(pid, gen);
  let polls: DashboardPollDto[];
  try {
    polls = await listDashboardPolls(pid);
  } catch {
    return;
  }
  if (refreshGenByParentId.get(pid) !== gen) return;
  const watermark = effectivePollsWatermarkMs(pid);
  const npub = get(currentUser)?.npub;
  const count = countUnseenPollCreates(polls, watermark, npub);
  unseenPollCreateCountByParentId.update((m) => ({ ...m, [pid]: count }));
}

export async function markPollsChannelSeen(parentId: string): Promise<void> {
  const pid = parentId.trim();
  if (!pid) return;
  const gen = (refreshGenByParentId.get(pid) ?? 0) + 1;
  refreshGenByParentId.set(pid, gen);
  let polls: DashboardPollDto[] = [];
  try {
    polls = await listDashboardPolls(pid);
  } catch {
    // still clear badge / bump watermark with wall clock
  }
  if (refreshGenByParentId.get(pid) !== gen) return;
  const maxCreated = polls.reduce((max, p) => Math.max(max, p.created_at_ms), 0);
  const watermark = maxCreated > 0 ? maxCreated : Date.now();
  lastSeenPollCreatedAtMsByParentId.update((m) => {
    const next = { ...m, [pid]: watermark };
    persistWatermarks(next);
    return next;
  });
  unseenPollCreateCountByParentId.update((m) => ({ ...m, [pid]: 0 }));
}
