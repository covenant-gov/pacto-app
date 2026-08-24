import { get, writable } from 'svelte/store';
import { persistenceKey } from '../../stores/persistence-context';
import type { CommonsBroadcastDto } from './types';

export const PACTO_COMMONS_JOIN_REQUESTS_PREFIX = 'pacto_commons_join_requests';
export const COMMONS_JOIN_REQUEST_COOLDOWN_SECS = 24 * 3600;

/** Bumps when join-request cooldown or in-flight state changes so Commons UI reacts without refresh. */
export const commonsJoinRequestRevision = writable(0);

/** Squad ids with a join DM currently in flight (survives Commons remount within the session). */
export const commonsJoinRequestInFlight = writable<Set<string>>(new Set());

export function resetCommonsJoinRequestRevision(): void {
  commonsJoinRequestInFlight.set(new Set());
  commonsJoinRequestRevision.set(0);
}

export function isJoinRequestInFlight(squadId: string): boolean {
  const id = squadId.trim();
  return id.length > 0 && get(commonsJoinRequestInFlight).has(id);
}

export function markJoinRequestInFlight(squadId: string): void {
  const id = squadId.trim();
  if (!id) return;
  commonsJoinRequestInFlight.update((s) => {
    if (s.has(id)) return s;
    const next = new Set(s);
    next.add(id);
    return next;
  });
  commonsJoinRequestRevision.update((n) => n + 1);
}

export function clearJoinRequestInFlight(squadId: string): void {
  const id = squadId.trim();
  if (!id) return;
  let removed = false;
  commonsJoinRequestInFlight.update((s) => {
    if (!s.has(id)) return s;
    removed = true;
    const next = new Set(s);
    next.delete(id);
    return next;
  });
  if (removed) commonsJoinRequestRevision.update((n) => n + 1);
}

export type CommonsJoinRequestRecord = {
  requestId: string;
  squadId: string;
  squadName: string;
  inboxNpub: string;
  broadcastEventId: string;
  sentAt: number;
};

type JoinRequestSentMap = Record<string, CommonsJoinRequestRecord>;

function readJoinRequestMap(): JoinRequestSentMap {
  if (typeof localStorage === 'undefined') return {};
  const key = persistenceKey(PACTO_COMMONS_JOIN_REQUESTS_PREFIX);
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JoinRequestSentMap)
      : {};
  } catch {
    return {};
  }
}

function writeJoinRequestMap(map: JoinRequestSentMap): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PACTO_COMMONS_JOIN_REQUESTS_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore quota
  }
}

export function isJoinRequestRateLimited(
  squadId: string,
  nowSecs = Math.floor(Date.now() / 1000)
): boolean {
  const record = readJoinRequestMap()[squadId.trim()];
  if (!record) return false;
  return nowSecs - record.sentAt < COMMONS_JOIN_REQUEST_COOLDOWN_SECS;
}

export function getJoinRequestRecord(squadId: string): CommonsJoinRequestRecord | null {
  return readJoinRequestMap()[squadId.trim()] ?? null;
}

export function recordJoinRequestSent(record: CommonsJoinRequestRecord): void {
  const id = record.squadId.trim();
  if (!id || !record.requestId.trim() || !record.inboxNpub.startsWith('npub1')) return;
  const map = readJoinRequestMap();
  map[id] = { ...record, squadId: id };
  writeJoinRequestMap(map);
  commonsJoinRequestRevision.update((n) => n + 1);
}

export function clearJoinRequestRecord(squadId: string, requestId: string): void {
  const id = squadId.trim();
  const map = readJoinRequestMap();
  if (map[id]?.requestId !== requestId.trim()) return;
  delete map[id];
  writeJoinRequestMap(map);
  commonsJoinRequestRevision.update((n) => n + 1);
}

export function squadIdFromBroadcast(broadcast: CommonsBroadcastDto): string {
  return (broadcast.squadId ?? broadcast.subjectId).trim();
}

export function isLocalSquadMember(squadId: string, localSquadIds: string[]): boolean {
  const id = squadId.trim();
  return id.length > 0 && localSquadIds.includes(id);
}

export function commonsJoinRequestBlockReason(
  broadcast: CommonsBroadcastDto,
  myNpub: string | undefined,
  localSquadIds: string[]
): string | null {
  if (broadcast.subject !== 'squad') return null;
  const squadId = squadIdFromBroadcast(broadcast);
  if (!squadId) return 'Missing squad id.';
  if (myNpub && broadcast.authorNpub === myNpub) return 'This is your broadcast.';
  if (isLocalSquadMember(squadId, localSquadIds)) return 'You are already in this squad.';
  if (isJoinRequestRateLimited(squadId)) return 'Join request sent recently.';
  return null;
}
