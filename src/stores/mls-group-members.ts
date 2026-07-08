import { get, writable } from 'svelte/store';
import { getMlsGroupMembers, syncMlsGroupsNow } from '../lib/api/nostr';
import { JOIN_REQUESTS_CHANNEL_ID, DASHBOARD_CHANNEL_ID } from '../lib/squad/hub-channel-names';

/** MLS group id → member npubs (shared across hub channels that share one group). */
export const membersByGroupId = writable<Record<string, string[]>>({});

export const membersLoadingByGroupId = writable<Record<string, boolean>>({});

const hydratedGroupIds = new Set<string>();
const loadingGroupIds = new Set<string>();

function isValidMembersGroupId(groupId: string | null | undefined): groupId is string {
  const id = groupId?.trim();
  if (!id) return false;
  if (id === DASHBOARD_CHANNEL_ID || id === JOIN_REQUESTS_CHANNEL_ID) return false;
  if (id.startsWith('creating-')) return false;
  return true;
}

function setMembersForGroup(groupId: string, members: string[]): void {
  const id = groupId.trim();
  membersByGroupId.update((m) => ({ ...m, [id]: members }));
  hydratedGroupIds.add(id);
}

async function fetchMembersForGroup(groupId: string, syncFirst: boolean): Promise<string[]> {
  const id = groupId.trim();
  if (syncFirst) await syncMlsGroupsNow(id).catch(() => {});
  const result = await getMlsGroupMembers(id);
  const members = result.members ?? [];
  setMembersForGroup(id, members);
  return members;
}

/** First load for a group this session; returns cached list when already hydrated. */
export async function ensureMlsGroupMembers(groupId: string): Promise<string[]> {
  if (!isValidMembersGroupId(groupId)) return [];
  const id = groupId.trim();
  if (hydratedGroupIds.has(id)) return get(membersByGroupId)[id] ?? [];
  if (loadingGroupIds.has(id)) return get(membersByGroupId)[id] ?? [];
  loadingGroupIds.add(id);
  membersLoadingByGroupId.update((m) => ({ ...m, [id]: true }));
  try {
    return await fetchMembersForGroup(id, false);
  } finally {
    loadingGroupIds.delete(id);
    membersLoadingByGroupId.update((m) => ({ ...m, [id]: false }));
  }
}

/** Relay sync + replace member list (membership change or explicit refresh). */
export async function refreshMlsGroupMembers(groupId: string): Promise<string[]> {
  if (!isValidMembersGroupId(groupId)) return [];
  const id = groupId.trim();
  if (loadingGroupIds.has(id)) return get(membersByGroupId)[id] ?? [];
  loadingGroupIds.add(id);
  membersLoadingByGroupId.update((m) => ({ ...m, [id]: true }));
  try {
    return await fetchMembersForGroup(id, true);
  } finally {
    loadingGroupIds.delete(id);
    membersLoadingByGroupId.update((m) => ({ ...m, [id]: false }));
  }
}

export function isMlsGroupMembersHydrated(groupId: string): boolean {
  const id = groupId?.trim();
  if (!id) return false;
  return hydratedGroupIds.has(id);
}

export function resetMlsGroupMembersStores(): void {
  membersByGroupId.set({});
  membersLoadingByGroupId.set({});
  hydratedGroupIds.clear();
  loadingGroupIds.clear();
}
