import { get, writable } from 'svelte/store';
import { currentUser } from './auth-session';
import { persistenceKey, setCurrentNpubForPersistence } from './persistence-context';

export const LAST_SEEN_EVENT_CARD_AT_PREFIX = 'pacto_last_seen_event_card_at_v1';

/** Per-parent `#events` watermark (ms): the first-seen baseline, then the newest card the user has seen. */
export const lastSeenEventCardAtMsByParentId = writable<Record<string, number>>({});

/** Sidebar badge counts for `#events` (unseen announcement cards by others). */
export const unseenEventCardCountByParentId = writable<Record<string, number>>({});

/** Bumped per parent on `squad_event_replica_updated`; shelf and cards refetch on change. */
export const squadEventReplicaNonceByParentId = writable<Record<string, number>>({});

export interface EventCardMessageLike {
  content: string;
  at: number;
  mine?: boolean;
  npub?: string;
}

export function resetEventsHubAlertStores(): void {
  lastSeenEventCardAtMsByParentId.set({});
  unseenEventCardCountByParentId.set({});
  squadEventReplicaNonceByParentId.set({});
}

export function bumpSquadEventReplicaNonce(parentId: string): void {
  const pid = parentId.trim();
  if (!pid) return;
  squadEventReplicaNonceByParentId.update((m) => ({ ...m, [pid]: (m[pid] ?? 0) + 1 }));
}

function persistWatermarks(map: Record<string, number>): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_SEEN_EVENT_CARD_AT_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function loadLastSeenEventCardAt(npub: string): void {
  setCurrentNpubForPersistence(npub);
  const key = typeof localStorage === 'undefined' ? null : persistenceKey(LAST_SEEN_EVENT_CARD_AT_PREFIX);
  const out: Record<string, number> = {};
  try {
    const parsed = key ? (JSON.parse(localStorage.getItem(key) ?? 'null') as unknown) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [pid, ms] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) out[pid] = ms;
      }
    }
  } catch {
    // corrupt value resets to empty
  }
  lastSeenEventCardAtMsByParentId.set(out);
}

/** Dedupe key for an event announcement card (`series:<id>` / `event:<id>`), or null for any other message. */
export function eventCardKey(content: string | null | undefined): string | null {
  const trimmed = (content ?? '').trim();
  if (!trimmed.startsWith('{')) return null;
  let root: unknown;
  try {
    root = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!root || typeof root !== 'object') return null;
  const { type, payload } = root as { type?: unknown; payload?: unknown };
  if (type !== 'squad_event_created' && type !== 'squad_event_series_created') return null;
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as { id?: unknown; series_id?: unknown };
  if (type === 'squad_event_series_created') {
    return typeof p.series_id === 'string' && p.series_id ? `series:${p.series_id}` : null;
  }
  return typeof p.id === 'string' && p.id ? `event:${p.id}` : null;
}

/** Unseen cards newer than the watermark, by others; one per event or series. */
export function countUnseenEventCards(
  messages: readonly EventCardMessageLike[],
  watermarkMs: number,
  currentNpub: string | null | undefined,
): number {
  const me = currentNpub?.trim() ?? '';
  const seen = new Set<string>();
  for (const m of messages) {
    if (m.at <= watermarkMs || m.mine) continue;
    if (me && m.npub?.trim() === me) continue;
    const key = eventCardKey(m.content);
    if (key) seen.add(key);
  }
  return seen.size;
}

/** First sight of a parent fixes its baseline so only cards arriving later badge, across restarts. */
function ensureBaseline(pid: string): number {
  const map = get(lastSeenEventCardAtMsByParentId);
  if (Object.prototype.hasOwnProperty.call(map, pid)) return map[pid] ?? 0;
  const baseline = Date.now();
  const next = { ...map, [pid]: baseline };
  lastSeenEventCardAtMsByParentId.set(next);
  persistWatermarks(next);
  return baseline;
}

/** Recount from the parent's loaded announcements-group messages. */
export function refreshUnseenEventCardsForParent(
  parentId: string,
  messages: readonly EventCardMessageLike[],
): void {
  const pid = parentId.trim();
  if (!pid) return;
  const watermark = ensureBaseline(pid);
  const count = countUnseenEventCards(messages, watermark, get(currentUser)?.npub);
  unseenEventCardCountByParentId.update((m) => (m[pid] === count ? m : { ...m, [pid]: count }));
}

/** Record that the user has seen `#events`: advance the watermark past every loaded card. */
export function markEventsChannelSeen(parentId: string, messages: readonly EventCardMessageLike[]): void {
  const pid = parentId.trim();
  if (!pid) return;
  const newestCard = messages.reduce((max, m) => (eventCardKey(m.content) ? Math.max(max, m.at) : max), 0);
  const seen = newestCard > 0 ? newestCard : Date.now();
  const current = get(lastSeenEventCardAtMsByParentId);
  if (!Object.prototype.hasOwnProperty.call(current, pid) || (current[pid] ?? 0) < seen) {
    const next = { ...current, [pid]: Math.max(current[pid] ?? 0, seen) };
    lastSeenEventCardAtMsByParentId.set(next);
    persistWatermarks(next);
  }
  unseenEventCardCountByParentId.update((m) => (m[pid] === 0 ? m : { ...m, [pid]: 0 }));
}
