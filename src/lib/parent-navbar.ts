/**
 * Shared channel helpers for squad parent sidebars (ParentNavbar).
 */
import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  INBOX_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
  type Channel,
} from '../stores/app';
import { createGroupChat, getMlsGroupMembers } from './api/nostr';

/** Parent-like shape: has an ordered list of channels (squad or network). */
export interface ParentWithChannels {
  channels: Channel[];
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

/** `#inbox` MLS channel when present. */
export function getInboxChannel(parent: ParentWithChannels): Channel | undefined {
  return parent.channels.find((c) => c.name === INBOX_CHANNEL_NAME);
}

/**
 * MLS group id for automated governance/treasury announce rows — prefers `#inbox`, falls back to `#announcements`.
 */
export function resolveAutomatedAnnounceGroupId(parent: ParentWithChannels): string | null {
  const inbox = getInboxChannel(parent)?.groupId?.trim();
  if (inbox) return inbox;
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
  const order = [ANNOUNCEMENTS_CHANNEL_NAME, INBOX_CHANNEL_NAME, POLLS_CHANNEL_NAME];
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

/** Default hub sidebar rows for an existing announcements MLS `groupId` (single-group default). */
export function defaultChannelRowsForGroupId(groupId: string): Channel[] {
  return [
    { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId, order: 0 },
    { name: INBOX_CHANNEL_NAME, groupId, order: 1 },
    { name: POLLS_CHANNEL_NAME, groupId, order: 2 },
  ];
}

/**
 * Backfill missing `#inbox` / `#polls` rows when a parent only persisted `#announcements`
 * (invite accept) but uses the single-group default MLS scope.
 */
export function ensureDefaultHubChannelRows(channels: Channel[]): Channel[] {
  const ann = channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME);
  const gid = ann?.groupId?.trim();
  if (!gid || gid.startsWith('creating-')) return channels;

  const hasInbox = channels.some((c) => c.name === INBOX_CHANNEL_NAME);
  const hasPolls = channels.some((c) => c.name === POLLS_CHANNEL_NAME);
  if (hasInbox && hasPolls) return channels;

  const defaultRows = channels.filter(
    (c) =>
      c.name === ANNOUNCEMENTS_CHANNEL_NAME ||
      c.name === INBOX_CHANNEL_NAME ||
      c.name === POLLS_CHANNEL_NAME
  );
  const singleGroupDefault =
    defaultRows.length <= 1 || defaultRows.every((c) => c.groupId === ann!.groupId);
  if (!singleGroupDefault) return channels;

  const extras = channels.filter(
    (c) =>
      c.name !== ANNOUNCEMENTS_CHANNEL_NAME &&
      c.name !== INBOX_CHANNEL_NAME &&
      c.name !== POLLS_CHANNEL_NAME
  );
  const merged = defaultChannelRowsForGroupId(gid);
  const custom = extras.map((c, i) => ({ ...c, order: 3 + i }));
  return [...merged, ...custom];
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
