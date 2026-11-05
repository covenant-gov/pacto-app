import { get, writable } from 'svelte/store';
import { currentUser } from './auth-session';
import { persistenceKey, setCurrentNpubForPersistence } from './persistence-context';
import {
  canAddSquadDoc,
  getSquadContentPolicy,
  type SquadContentPolicyView,
} from '../lib/api/squad-content-policy';

export const LAST_SEEN_DOC_CARD_AT_PREFIX = 'pacto_last_seen_doc_card_at_v1';

/** Per-parent `#docs` watermark (ms): the first-seen baseline, then the newest card the user has seen. */
export const lastSeenDocCardAtMsByParentId = writable<Record<string, number>>({});

/** Sidebar badge counts for `#docs` (unseen doc-added cards by others). */
export const unseenDocCardCountByParentId = writable<Record<string, number>>({});

/** Bumped per parent on `squad_doc_replica_updated`; the shelf refetches on change. */
export const squadDocReplicaNonceByParentId = writable<Record<string, number>>({});

/**
 * Content policy per parent for the Save to Docs gate. Absent = not loaded yet; `null` = load failed
 * (the item stays offered and the backend still enforces the restriction).
 */
export const squadDocAddPolicyByParentId = writable<Record<string, SquadContentPolicyView | null>>({});

const policyGroupByParentId = new Map<string, string>();
const policyGenByParentId = new Map<string, number>();
/** Announcements-group membership version the loaded policy reflects (admin set changes bump it). */
const policyMembershipVersionByParentId = new Map<string, number>();

export interface DocCardMessageLike {
  content: string;
  at: number;
  mine?: boolean;
  npub?: string;
}

export function resetDocsHubAlertStores(): void {
  lastSeenDocCardAtMsByParentId.set({});
  unseenDocCardCountByParentId.set({});
  squadDocReplicaNonceByParentId.set({});
  squadDocAddPolicyByParentId.set({});
  policyGroupByParentId.clear();
  policyGenByParentId.clear();
  policyMembershipVersionByParentId.clear();
}

export function bumpSquadDocReplicaNonce(parentId: string): void {
  const pid = parentId.trim();
  if (!pid) return;
  squadDocReplicaNonceByParentId.update((m) => ({ ...m, [pid]: (m[pid] ?? 0) + 1 }));
}

/** Save to Docs is offered once the policy allows the caller to add, or when the policy could not be read. */
export function canOfferSaveToDocs(policy: SquadContentPolicyView | null | undefined): boolean {
  if (policy === undefined) return false;
  return policy === null || canAddSquadDoc(policy);
}

/** Load (or reload) the add policy for a parent's announcements group. */
export async function loadSquadDocAddPolicy(mlsGroupId: string, parentId: string): Promise<void> {
  const gid = mlsGroupId.trim();
  const pid = parentId.trim();
  if (!gid || !pid) return;
  policyGroupByParentId.set(pid, gid);
  const gen = (policyGenByParentId.get(pid) ?? 0) + 1;
  policyGenByParentId.set(pid, gen);
  let view: SquadContentPolicyView | null;
  try {
    view = await getSquadContentPolicy(gid, pid);
  } catch {
    view = null;
  }
  if (policyGenByParentId.get(pid) !== gen) return;
  squadDocAddPolicyByParentId.update((m) => ({ ...m, [pid]: view }));
}

/** Loads once per parent and group, and again whenever the group's membership version changes. */
export function ensureSquadDocAddPolicy(
  mlsGroupId: string | null | undefined,
  parentId: string,
  membershipVersion: number,
): void {
  const pid = parentId.trim();
  const gid = mlsGroupId?.trim() ?? '';
  if (!pid || !gid) return;
  if (policyGroupByParentId.get(pid) === gid && policyMembershipVersionByParentId.get(pid) === membershipVersion) return;
  policyMembershipVersionByParentId.set(pid, membershipVersion);
  void loadSquadDocAddPolicy(gid, pid);
}

/** `squad_content_policy_updated`: refresh parents that were already loaded. */
export function reloadSquadDocAddPolicy(parentId: string): void {
  const pid = parentId.trim();
  const gid = policyGroupByParentId.get(pid);
  if (gid) void loadSquadDocAddPolicy(gid, pid);
}

function persistWatermarks(map: Record<string, number>): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_SEEN_DOC_CARD_AT_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function loadLastSeenDocCardAt(npub: string): void {
  setCurrentNpubForPersistence(npub);
  const key = typeof localStorage === 'undefined' ? null : persistenceKey(LAST_SEEN_DOC_CARD_AT_PREFIX);
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
  lastSeenDocCardAtMsByParentId.set(out);
}

/** Doc id of a `squad_doc_added` card, or null for any other message (updates and removes post no card). */
export function docCardKey(content: string | null | undefined): string | null {
  const trimmed = (content ?? '').trim();
  if (!trimmed.startsWith('{')) return null;
  let root: unknown;
  try {
    root = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!root || typeof root !== 'object' || !('type' in root) || root.type !== 'squad_doc_added') return null;
  if (!('payload' in root) || !root.payload || typeof root.payload !== 'object') return null;
  const id = 'id' in root.payload ? root.payload.id : null;
  return typeof id === 'string' && id ? id : null;
}

/** Unseen doc-added cards newer than the watermark, by others; one per doc. */
export function countUnseenDocCards(
  messages: readonly DocCardMessageLike[],
  watermarkMs: number,
  currentNpub: string | null | undefined,
): number {
  const me = currentNpub?.trim() ?? '';
  const seen = new Set<string>();
  for (const m of messages) {
    if (m.at <= watermarkMs || m.mine) continue;
    if (me && m.npub?.trim() === me) continue;
    const key = docCardKey(m.content);
    if (key) seen.add(key);
  }
  return seen.size;
}

/** First sight of a parent fixes its baseline so only cards arriving later badge, across restarts. */
function ensureBaseline(pid: string): number {
  const map = get(lastSeenDocCardAtMsByParentId);
  if (Object.prototype.hasOwnProperty.call(map, pid)) return map[pid] ?? 0;
  const baseline = Date.now();
  const next = { ...map, [pid]: baseline };
  lastSeenDocCardAtMsByParentId.set(next);
  persistWatermarks(next);
  return baseline;
}

/** Recount from the parent's loaded announcements-group messages. */
export function refreshUnseenDocCardsForParent(parentId: string, messages: readonly DocCardMessageLike[]): void {
  const pid = parentId.trim();
  if (!pid) return;
  const watermark = ensureBaseline(pid);
  const count = countUnseenDocCards(messages, watermark, get(currentUser)?.npub);
  unseenDocCardCountByParentId.update((m) => (m[pid] === count ? m : { ...m, [pid]: count }));
}

/** Record that the user has seen `#docs`: advance the watermark past every loaded card. */
export function markDocsChannelSeen(parentId: string, messages: readonly DocCardMessageLike[]): void {
  const pid = parentId.trim();
  if (!pid) return;
  const newestCard = messages.reduce((max, m) => (docCardKey(m.content) ? Math.max(max, m.at) : max), 0);
  const seen = newestCard > 0 ? newestCard : Date.now();
  const current = get(lastSeenDocCardAtMsByParentId);
  if (!Object.prototype.hasOwnProperty.call(current, pid) || (current[pid] ?? 0) < seen) {
    const next = { ...current, [pid]: Math.max(current[pid] ?? 0, seen) };
    lastSeenDocCardAtMsByParentId.set(next);
    persistWatermarks(next);
  }
  unseenDocCardCountByParentId.update((m) => (m[pid] === 0 ? m : { ...m, [pid]: 0 }));
}
