/**
 * Shared channel helpers for squad parent sidebars (ParentNavbar).
 */
import type { Channel } from '../stores/squads';
import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  DASHBOARD_CHANNEL_ID,
  DASHBOARD_CHANNEL_NAME,
  JOIN_REQUESTS_CHANNEL_ID,
  JOIN_REQUESTS_CHANNEL_NAME,
  PERSONAL_ALERTS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
} from './squad/hub-channel-names';
import {
  defaultChannelRowsForGroupId,
  ensureDefaultHubChannelRows,
} from './squad/hub-channel-rows';
import { createGroupChat, getMlsGroupMembers } from './api/nostr';

export { defaultChannelRowsForGroupId, ensureDefaultHubChannelRows };

/** Parent-like shape: has an ordered list of channels (squad or network). */
export interface ParentWithChannels {
  channels: Channel[];
}

/** Built-in hub rows (dashboard + default MLS trio), not user-created chat channels. */
export function isDefaultHubSidebarChannel(name: string): boolean {
  return (
    name === DASHBOARD_CHANNEL_NAME ||
    name === ANNOUNCEMENTS_CHANNEL_NAME ||
    name === JOIN_REQUESTS_CHANNEL_NAME ||
    name === PERSONAL_ALERTS_CHANNEL_NAME ||
    name === POLLS_CHANNEL_NAME
  );
}

/** Virtual + MLS rows shown in the squad hub sidebar (dashboard first, join-requests under announcements). */
export function buildHubSidebarChannels<T extends { name: string; groupId: string; order: number }>(
  rawChannels: T[]
): Array<T | { name: string; groupId: string; order: number }> {
  const sorted = [...rawChannels].sort((a, b) => a.order - b.order);
  const announcements = sorted.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME);
  const rest = sorted.filter((c) => c.name !== ANNOUNCEMENTS_CHANNEL_NAME);
  const out: Array<T | { name: string; groupId: string; order: number }> = [
    { name: DASHBOARD_CHANNEL_NAME, groupId: DASHBOARD_CHANNEL_ID, order: -1 },
  ];
  if (announcements) out.push(announcements);
  out.push({
    name: JOIN_REQUESTS_CHANNEL_NAME,
    groupId: JOIN_REQUESTS_CHANNEL_ID,
    order: announcements?.order ?? 0,
  });
  out.push(...rest);
  return out;
}

export function partitionHubSidebarChannels<T extends { name: string }>(
  channels: T[]
): { defaultHubChannels: T[]; customChannels: T[] } {
  const defaultHubChannels: T[] = [];
  const customChannels: T[] = [];
  for (const ch of channels) {
    if (isDefaultHubSidebarChannel(ch.name)) defaultHubChannels.push(ch);
    else customChannels.push(ch);
  }
  return { defaultHubChannels, customChannels };
}

/**
 * Return the announcements channel for a parent (squad or network), or the first channel by order.
 */
export function getAnnouncementsChannel(parent: ParentWithChannels): Channel {
  return (
    parent.channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME) ??
    [...parent.channels].sort((a, b) => a.order - b.order)[0]
  );
}

/** `#personal-alerts` MLS channel when present. */
export function getPersonalAlertsChannel(parent: ParentWithChannels): Channel | undefined {
  return parent.channels.find((c) => c.name === PERSONAL_ALERTS_CHANNEL_NAME);
}

/**
 * MLS group id for automated governance/treasury announce rows — prefers `#personal-alerts`, falls back to `#announcements`.
 */
export function resolveAutomatedAnnounceGroupId(parent: ParentWithChannels): string | null {
  const personalAlerts = getPersonalAlertsChannel(parent)?.groupId?.trim();
  if (personalAlerts) return personalAlerts;
  const ann = getAnnouncementsChannel(parent)?.groupId?.trim();
  return ann || null;
}

/**
 * MLS group id for dashboard poll create/vote (Kind **30078** rumors).
 * Always the parent **#announcements** MLS scope — the same physical group as virtual `#polls` under single-group defaults.
 */
export function resolvePollsMlsGroupId(parent: ParentWithChannels): string | null {
  const ann = getAnnouncementsChannel(parent)?.groupId?.trim();
  return ann || null;
}

/** Default squad/network MLS rooms to invite people into (announce → inbox → polls). May share one physical group id. */
export function orderedDefaultInviteChannels(parent: ParentWithChannels): Channel[] {
  const order = [ANNOUNCEMENTS_CHANNEL_NAME, PERSONAL_ALERTS_CHANNEL_NAME, POLLS_CHANNEL_NAME];
  return order
    .map((name) => parent.channels.find((c) => c.name === name))
    .filter((c): c is Channel => !!c);
}

/**
 * Physical MLS groups to add an invitee to for this parent's default hub channels.
 * When announcements, inbox, and polls share one `groupId`, this returns a single entry so the backend sends one MLS welcome for the whole default scope.
 */
export function defaultParentInvitePhysicalGroupTargets(parent: ParentWithChannels): Channel[] {
  const announcementsChannel = getAnnouncementsChannel(parent);
  const inviteChannels = orderedDefaultInviteChannels(parent);
  if (inviteChannels.length > 0) {
    return uniqueChannelsByGroupIdPreservingOrder(inviteChannels);
  }
  return [announcementsChannel];
}

/** One entry per physical MLS group id; keeps first channel row per id (announce → inbox → polls order). Skips `creating-*` placeholders. */
export function uniqueChannelsByGroupIdPreservingOrder(channels: Channel[]): Channel[] {
  const seen = new Set<string>();
  const out: Channel[] = [];
  for (const ch of channels) {
    const gid = ch.groupId.trim();
    if (!gid || gid.startsWith('creating-') || seen.has(gid)) continue;
    seen.add(gid);
    out.push(ch);
  }
  return out;
}

/**
 * Create one MLS group for the parent default scope; announcements, inbox, and polls sidebar rows share its `groupId`.
 * Parent id remains that MLS id (roster and invites reference this id).
 */
export async function createDefaultParentChannels(
  memberNpubs: string[]
): Promise<{ parentId: string; channels: Channel[] }> {
  const groupId = await createGroupChat(ANNOUNCEMENTS_CHANNEL_NAME, memberNpubs);
  return { parentId: groupId, channels: defaultChannelRowsForGroupId(groupId) };
}

/**
 * Load member npubs for a parent (from its announcements group), excluding the current user.
 * Used for "create channel" member list and invite candidates.
 */
export async function loadMembersForParent(
  parent: ParentWithChannels,
  currentUserNpub: string | undefined
): Promise<string[]> {
  const ann = getAnnouncementsChannel(parent);
  const result = await getMlsGroupMembers(ann.groupId);
  return (result.members ?? []).filter((n) => n !== currentUserNpub);
}
