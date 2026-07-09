import { writable } from 'svelte/store';
import { persistenceKey } from '../../stores/persistence-context';
import type { CommonsBroadcastDto } from './types';

export const PACTO_COMMONS_JOIN_REQUESTS_PREFIX = 'pacto_commons_join_requests';
export const COMMONS_JOIN_REQUEST_COOLDOWN_SECS = 24 * 3600;

/** Bumps when join-request cooldown state changes so Commons UI reacts without refresh. */
export const commonsJoinRequestRevision = writable(0);

export function resetCommonsJoinRequestRevision(): void {
  commonsJoinRequestRevision.set(0);
}

type JoinRequestSentMap = Record<string, number>;

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
  const sentAt = readJoinRequestMap()[squadId.trim()];
  if (!sentAt) return false;
  return nowSecs - sentAt < COMMONS_JOIN_REQUEST_COOLDOWN_SECS;
}

export function recordJoinRequestSent(squadId: string, nowSecs = Math.floor(Date.now() / 1000)): void {
  const id = squadId.trim();
  if (!id) return;
  const map = readJoinRequestMap();
  map[id] = nowSecs;
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
