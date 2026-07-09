import { get, writable } from 'svelte/store';
import type { CommonsJoinRequestDto } from '../lib/commons/types';
import { getInvokeErrorMessage } from '../lib/utils/tauri-errors';
import {
  fanOutBotJoinDmsToMls,
  loadPendingJoinRequestsFromMls,
} from '../lib/squad/squad-join-mls';

/** Squad-wide pending join requests from MLS join_requests bucket. */
export const pendingJoinRequestsBySquadId = writable<Record<string, CommonsJoinRequestDto[]>>({});

/** True after the first successful fetch for a squad this session. */
export const joinRequestsHydratedBySquadId = writable<Record<string, boolean>>({});

/** True while a squad inbox is fetching from the backend. */
export const joinRequestsSyncingBySquadId = writable<Record<string, boolean>>({});

/** Load failures for holders (not "no pending requests"). */
export const joinRequestsErrorBySquadId = writable<Record<string, string>>({});

const hydratingSquadIds = new Set<string>();

export function getJoinRequestPendingCount(
  squadId: string,
  bySquad = get(pendingJoinRequestsBySquadId)
): number {
  const id = squadId.trim();
  if (!id) return 0;
  return (bySquad[id] ?? []).length;
}

export function isJoinRequestsHydrated(squadId: string): boolean {
  const id = squadId.trim();
  if (!id) return false;
  return get(joinRequestsHydratedBySquadId)[id] === true;
}

function setPendingForSquad(squadId: string, requests: CommonsJoinRequestDto[]): void {
  const id = squadId.trim();
  if (!id) return;
  pendingJoinRequestsBySquadId.update((m) => ({ ...m, [id]: requests }));
  joinRequestsHydratedBySquadId.update((m) => ({ ...m, [id]: true }));
}

function setErrorForSquad(squadId: string, error: string | null): void {
  const id = squadId.trim();
  if (!id) return;
  joinRequestsErrorBySquadId.update((m) => {
    if (!error) {
      if (!(id in m)) return m;
      const next = { ...m };
      delete next[id];
      return next;
    }
    return { ...m, [id]: error };
  });
}

async function fetchPendingForSquad(squadId: string): Promise<CommonsJoinRequestDto[]> {
  const id = squadId.trim();
  setErrorForSquad(id, null);
  try {
    await fanOutBotJoinDmsToMls(id);
  } catch (e) {
    const message = getInvokeErrorMessage(e, 'Could not sync bot inbox.');
    setErrorForSquad(id, message);
    setPendingForSquad(id, []);
    return [];
  }
  try {
    const requests = await loadPendingJoinRequestsFromMls(id);
    setPendingForSquad(id, requests);
    return requests;
  } catch (e) {
    const message = getInvokeErrorMessage(e, 'Could not load join requests.');
    setErrorForSquad(id, message);
    setPendingForSquad(id, []);
    throw new Error(message, { cause: e });
  }
}

/** First load for a squad this session; no-op when already hydrated or in flight. */
export async function ensureJoinRequestsHydrated(squadId: string): Promise<void> {
  const id = squadId.trim();
  if (!id || isJoinRequestsHydrated(id) || hydratingSquadIds.has(id)) return;
  hydratingSquadIds.add(id);
  joinRequestsSyncingBySquadId.update((m) => ({ ...m, [id]: true }));
  try {
    await fetchPendingForSquad(id);
  } catch {
    // error stored in joinRequestsErrorBySquadId
  } finally {
    hydratingSquadIds.delete(id);
    joinRequestsSyncingBySquadId.update((m) => ({ ...m, [id]: false }));
  }
}

/** Bot inbox sync + MLS reload (manual refresh or background squad update). */
export async function syncJoinRequestsForSquad(squadId: string): Promise<void> {
  const id = squadId.trim();
  if (!id || hydratingSquadIds.has(id)) return;
  hydratingSquadIds.add(id);
  joinRequestsSyncingBySquadId.update((m) => ({ ...m, [id]: true }));
  try {
    await fetchPendingForSquad(id);
  } finally {
    hydratingSquadIds.delete(id);
    joinRequestsSyncingBySquadId.update((m) => ({ ...m, [id]: false }));
  }
}

export async function ensureJoinRequestsHydratedForSquads(squads: { id: string }[]): Promise<void> {
  await Promise.all(squads.map((s) => ensureJoinRequestsHydrated(s.id)));
}

/** Decrement badge when a request is accepted or rejected locally. */
export function removePendingJoinRequest(squadId: string, eventId: string): void {
  const id = squadId.trim();
  const eid = eventId.trim();
  if (!id || !eid) return;
  pendingJoinRequestsBySquadId.update((m) => {
    const list = m[id] ?? [];
    const next = list.filter((r) => r.eventId !== eid);
    if (next.length === list.length) return m;
    return { ...m, [id]: next };
  });
}

export function resetSquadJoinRequestStores(): void {
  pendingJoinRequestsBySquadId.set({});
  joinRequestsHydratedBySquadId.set({});
  joinRequestsSyncingBySquadId.set({});
  joinRequestsErrorBySquadId.set({});
  hydratingSquadIds.clear();
}
