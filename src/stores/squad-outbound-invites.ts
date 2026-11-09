import { get, writable } from 'svelte/store';
import { getInvokeErrorMessage } from '../lib/utils/tauri-errors';
import {
  loadPendingOutboundInvitesFromMls,
  type PendingOutboundInviteDto,
} from '../lib/squad/squad-outbound-invite';
import { t } from 'svelte-i18n';

/** Squad-wide pending outbound invites from announcements MLS. */
export const pendingOutboundInvitesBySquadId = writable<Record<string, PendingOutboundInviteDto[]>>({});

export const outboundInvitesHydratedBySquadId = writable<Record<string, boolean>>({});

export const outboundInvitesSyncingBySquadId = writable<Record<string, boolean>>({});

export const outboundInvitesErrorBySquadId = writable<Record<string, string>>({});

const hydratingSquadIds = new Set<string>();

export function isOutboundInvitesHydrated(squadId: string): boolean {
  const id = squadId.trim();
  if (!id) return false;
  return get(outboundInvitesHydratedBySquadId)[id] === true;
}

function setPendingForSquad(squadId: string, invites: PendingOutboundInviteDto[]): void {
  const id = squadId.trim();
  if (!id) return;
  pendingOutboundInvitesBySquadId.update((m) => ({ ...m, [id]: invites }));
  outboundInvitesHydratedBySquadId.update((m) => ({ ...m, [id]: true }));
}

function setErrorForSquad(squadId: string, error: string | null): void {
  const id = squadId.trim();
  if (!id) return;
  outboundInvitesErrorBySquadId.update((m) => {
    if (!error) {
      if (!(id in m)) return m;
      const next = { ...m };
      delete next[id];
      return next;
    }
    return { ...m, [id]: error };
  });
}

async function fetchPendingForSquad(squadId: string): Promise<PendingOutboundInviteDto[]> {
  const id = squadId.trim();
  setErrorForSquad(id, null);
  try {
    const invites = await loadPendingOutboundInvitesFromMls(id);
    setPendingForSquad(id, invites);
    return invites;
  } catch (e) {
    const message = getInvokeErrorMessage(e, get(t)('squad.pendingAccess.loadInvitesFailed'));
    setErrorForSquad(id, message);
    setPendingForSquad(id, []);
    throw new Error(message, { cause: e });
  }
}

export async function ensureOutboundInvitesHydrated(squadId: string): Promise<void> {
  const id = squadId.trim();
  if (!id || isOutboundInvitesHydrated(id) || hydratingSquadIds.has(id)) return;
  hydratingSquadIds.add(id);
  outboundInvitesSyncingBySquadId.update((m) => ({ ...m, [id]: true }));
  try {
    await fetchPendingForSquad(id);
  } catch {
    // error stored in outboundInvitesErrorBySquadId
  } finally {
    hydratingSquadIds.delete(id);
    outboundInvitesSyncingBySquadId.update((m) => ({ ...m, [id]: false }));
  }
}

export async function syncOutboundInvitesForSquad(squadId: string): Promise<void> {
  const id = squadId.trim();
  if (!id || hydratingSquadIds.has(id)) return;
  hydratingSquadIds.add(id);
  outboundInvitesSyncingBySquadId.update((m) => ({ ...m, [id]: true }));
  try {
    await fetchPendingForSquad(id);
  } catch {
    // error stored in outboundInvitesErrorBySquadId
  } finally {
    hydratingSquadIds.delete(id);
    outboundInvitesSyncingBySquadId.update((m) => ({ ...m, [id]: false }));
  }
}

export async function ensureOutboundInvitesHydratedForSquads(squads: { id: string }[]): Promise<void> {
  await Promise.all(squads.map((s) => ensureOutboundInvitesHydrated(s.id)));
}

export function removePendingOutboundInvite(squadId: string, inviteId: string): void {
  const id = squadId.trim();
  const iid = inviteId.trim();
  if (!id || !iid) return;
  pendingOutboundInvitesBySquadId.update((m) => {
    const list = m[id] ?? [];
    const next = list.filter((r) => r.inviteId !== iid);
    if (next.length === list.length) return m;
    return { ...m, [id]: next };
  });
}

export function resetSquadOutboundInviteStores(): void {
  pendingOutboundInvitesBySquadId.set({});
  outboundInvitesHydratedBySquadId.set({});
  outboundInvitesSyncingBySquadId.set({});
  outboundInvitesErrorBySquadId.set({});
  hydratingSquadIds.clear();
}
