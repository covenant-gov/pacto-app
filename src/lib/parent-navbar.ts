/**
 * Shared logic for squad and network sidebars (ParentNavbar behaviour).
 * Used by ParentNavbar.svelte so squad and network behaviour is not duplicated.
 */
import { ANNOUNCEMENTS_CHANNEL_NAME, type Channel } from '../stores/app';
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

/**
 * Create the MLS announcements group and return its groupId and channel descriptor.
 * Shared by squad and network creation/retry flows.
 */
export async function createAnnouncementsGroupAndChannel(
  memberNpubs: string[]
): Promise<{ groupId: string; channel: Channel }> {
  const groupId = await createGroupChat(ANNOUNCEMENTS_CHANNEL_NAME, memberNpubs);
  const channel: Channel = { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId, order: 0 };
  return { groupId, channel };
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
