import { invoke } from "@tauri-apps/api/core";
import { dmLog } from "../utils/dm-debug";

/**
 * Represents a user status
 */
export interface Status {
  title: string;
  purpose: string;
  url: string;
}

/**
 * Represents a user profile
 */
export interface NostrProfile {
  id: string;
  name: string;
  avatar: string;
  last_read: string;
  status: Status;
  last_updated: number;
  typing_until: number;
  mine: boolean;
  // Extended fields from Rust backend
  display_name: string;
  nickname: string;
  lud06: string;
  lud16: string;
  banner: string;
  about: string;
  website: string;
  nip05: string;
  muted: boolean;
  bot: boolean;
  // Cached image paths (for offline support)
  avatar_cached: string;
  banner_cached: string;
}

/**
 * Fetch a Nostr profile from the Rust backend cache
 * @param npub - The npub (bech32 format) of the user
 * @returns Promise with the user's profile data
 */
export async function fetchNostrProfile(npub: string): Promise<NostrProfile> {
  return await invoke('get_profile', { npub });
}

/**
 * Load a profile from Nostr relays (triggers background fetch and caching)
 * @param npub - The npub (bech32 format) of the user
 * @returns Promise with boolean indicating if load was initiated
 */
export async function loadNostrProfile(npub: string): Promise<boolean> {
  return await invoke('load_profile', { npub });
}

/**
 * Force immediate refresh of a profile from Nostr (critical priority)
 * @param npub - The npub (bech32 format) of the user
 */
export async function refreshProfileNow(npub: string): Promise<void> {
  return await invoke('refresh_profile_now', { npub });
}

/**
 * Fetch DMs from Nostr relays (backend: fetch_messages).
 * Pulls Gift Wraps (kind 1059) for our pubkey, unwraps and stores in state/DB, then emits init_finished with profiles + chats.
 * Call after login so DMs are loaded from relays.
 */
export async function fetchMessages(init: boolean, relayUrl?: string): Promise<void> {
  dmLog('fetch_messages', { init, relayUrl: relayUrl ?? null });
  await invoke('fetch_messages', {
    init,
    relay_url: relayUrl ?? null,
  });
  dmLog('fetch_messages done', { init });
}

/**
 * Start live subscriptions for DMs and group messages (backend: notifs).
 * Subscribes to Gift Wrap (kind 1059) and MlsGroupMessage (kind 444); relays then push new events.
 * Call after init_finished so new messages arrive via push, not polling.
 */
export async function startNotifs(): Promise<boolean> {
  dmLog('notifs() starting live subscriptions');
  const ok = (await invoke('notifs')) as boolean;
  dmLog('notifs() done', ok);
  return ok;
}

/**
 * Get total message count for a DM chat (backend: get_chat_message_count).
 * Used for pagination / "load older".
 */
export async function getChatMessageCount(chatId: string): Promise<number> {
  dmLog('get_chat_message_count', { chatId: chatId.slice(0, 20) + '…' });
  const count = (await invoke('get_chat_message_count', { chatId })) as number;
  dmLog('get_chat_message_count result', { count });
  return count;
}

/**
 * Get paginated messages for a DM chat (backend: get_message_views).
 * chat_id = npub for DMs; reads from backend DB (filled by fetch_messages from relays).
 */
export async function getDmMessages(
  chatId: string,
  limit: number,
  offset: number
): Promise<Array<{ id: string; content: string; at: number; mine: boolean; npub?: string }>> {
  dmLog('get_message_views', { chatId: chatId.slice(0, 20) + '…', limit, offset });
  const msgs = await invoke('get_message_views', {
    chatId,
    limit,
    offset,
  }) as Array<{ id: string; content: string; at: number; mine: boolean; npub?: string }>;
  dmLog('get_message_views result', { count: msgs.length });
  return msgs;
}

/**
 * Queue all profiles in backend state for sync from Nostr.
 * Call after init_finished so contacts' names and PFPs fill in over time.
 * Backend: sync_all_profiles.
 */
export async function syncAllProfiles(): Promise<void> {
  dmLog('sync_all_profiles');
  await invoke('sync_all_profiles');
  dmLog('sync_all_profiles done');
}

/**
 * Update own profile and publish to Nostr.
 * Backend: update_profile. Pass current avatar/banner to preserve when only changing name/about.
 */
export async function updateProfile(params: {
  name: string;
  avatar: string;
  banner: string;
  about: string;
}): Promise<boolean> {
  dmLog('update_profile', { nameLen: params.name?.length ?? 0 });
  const ok = (await invoke('update_profile', {
    name: params.name ?? '',
    avatar: params.avatar ?? '',
    banner: params.banner ?? '',
    about: params.about ?? '',
  })) as boolean;
  dmLog('update_profile result', { ok });
  return ok;
}

/**
 * Upload avatar or banner image to Blossom; returns URL.
 * Use the returned URL in update_profile for avatar or banner.
 * Backend: upload_avatar. Emits profile_upload_progress.
 */
export async function uploadAvatar(
  filepath: string,
  uploadType: 'avatar' | 'banner'
): Promise<string> {
  dmLog('upload_avatar', { uploadType });
  const url = (await invoke('upload_avatar', {
    filepath,
    upload_type: uploadType,
  })) as string;
  dmLog('upload_avatar result', { urlLen: url?.length ?? 0 });
  return url;
}

/**
 * Set local nickname for a contact. Backend emits profile_nick_changed.
 */
export async function setNickname(npub: string, nickname: string): Promise<boolean> {
  dmLog('set_nickname', { npub: npub.slice(0, 20) + '…', nicknameLen: nickname?.length ?? 0 });
  const ok = (await invoke('set_nickname', { npub, nickname: nickname ?? '' })) as boolean;
  dmLog('set_nickname result', { ok });
  return ok;
}

/**
 * Queue profile sync for a contact (e.g. when opening a DM).
 * Backend: queue_profile_sync.
 */
export async function queueProfileSync(
  npub: string,
  priority: 'low' | 'medium' | 'high' | 'critical' = 'medium',
  forceRefresh = false
): Promise<void> {
  dmLog('queue_profile_sync', { npub: npub.slice(0, 20) + '…', priority, forceRefresh });
  return await invoke('queue_profile_sync', {
    npub,
    priority,
    force_refresh: forceRefresh,
  });
}

/**
 * Notify the other party that we are typing (backend: start_typing).
 */
export async function startTyping(receiver: string): Promise<boolean> {
  dmLog('start_typing', { receiver: receiver.slice(0, 20) + '…' });
  const ok = (await invoke('start_typing', { receiver })) as boolean;
  return ok;
}

/**
 * Mark a conversation as read up to a message (backend: mark_as_read).
 * Pass last message id when opening or scrolling to bottom.
 */
export async function markAsRead(chatId: string, messageId: string | null): Promise<boolean> {
  dmLog('mark_as_read', { chatId: chatId.slice(0, 20) + '…', messageId: messageId?.slice(0, 12) ?? null });
  const ok = (await invoke('mark_as_read', { chatId, messageId })) as boolean;
  dmLog('mark_as_read result', ok);
  return ok;
}

/**
 * Send a DM to an npub (NIP-17 gift wrap). Calls backend message command.
 * Also used for group messages: pass group_id as receiver.
 */
export async function sendDmMessage(
  receiver: string,
  content: string,
  repliedTo: string = ''
): Promise<boolean> {
  dmLog('message (send DM)', { receiver: receiver.slice(0, 20) + '…', contentLen: content.length, repliedTo: repliedTo || '(none)' });
  const ok = (await invoke('message', {
    receiver,
    content,
    repliedTo,
    file: null,
  })) as boolean;
  dmLog('message result', { ok });
  return ok;
}

// --- MLS / Squads ---

/** Pending MLS welcome (invite). Backend: SimpleWelcome. */
export interface PendingMlsWelcome {
  id: string;
  wrapper_event_id: string;
  nostr_group_id: string;
  group_name: string;
  group_description: string | null;
  group_image_url?: string | null;
  group_admin_pubkeys: string[];
  group_relays: string[];
  welcomer: string;
  member_count: number;
}

/** MLS group members. Backend: GroupMembers. */
export interface MlsGroupMembers {
  group_id: string;
  members: string[];
  admins: string[];
}

/**
 * Create a new MLS group (channel). Backend: create_group_chat.
 * Returns group_id (hex). Emits mls_group_initial_sync.
 */
export async function createGroupChat(
  groupName: string,
  memberIds: string[]
): Promise<string> {
  dmLog('create_group_chat', { groupName: groupName.slice(0, 20), memberCount: memberIds.length });
  const groupId = (await invoke('create_group_chat', {
    groupName,
    memberIds,
  })) as string;
  dmLog('create_group_chat result', { groupId: groupId?.slice(0, 16) + '…' });
  return groupId;
}

/**
 * List MLS group IDs the user is in. Backend: list_mls_groups.
 */
export async function listMlsGroups(): Promise<string[]> {
  dmLog('list_mls_groups');
  const ids = (await invoke('list_mls_groups')) as string[];
  dmLog('list_mls_groups result', { count: ids.length });
  return ids;
}

/**
 * Get metadata for all MLS groups. Backend: get_mls_group_metadata.
 * Returns array of group metadata objects (shape from backend DB).
 */
export async function getMlsGroupMetadata(): Promise<unknown[]> {
  dmLog('get_mls_group_metadata');
  const meta = (await invoke('get_mls_group_metadata')) as unknown[];
  dmLog('get_mls_group_metadata result', { count: meta.length });
  return meta;
}

/**
 * List pending MLS welcomes (invites). Backend: list_pending_mls_welcomes.
 */
export async function listPendingMlsWelcomes(): Promise<PendingMlsWelcome[]> {
  dmLog('list_pending_mls_welcomes');
  const list = (await invoke('list_pending_mls_welcomes')) as PendingMlsWelcome[];
  dmLog('list_pending_mls_welcomes result', { count: list.length });
  return list;
}

/**
 * Accept an MLS welcome (join group). Backend: accept_mls_welcome.
 * Pass welcome event id (hex). Emits mls_welcome_accepted / mls_group_updated.
 */
export async function acceptMlsWelcome(welcomeEventIdHex: string): Promise<boolean> {
  dmLog('accept_mls_welcome', { id: welcomeEventIdHex.slice(0, 16) + '…' });
  const ok = (await invoke('accept_mls_welcome', {
    welcomeEventIdHex,
  })) as boolean;
  dmLog('accept_mls_welcome result', { ok });
  return ok;
}

/**
 * Invite a member (npub) to an MLS group. Backend: invite_member_to_group.
 */
export async function inviteMemberToGroup(
  groupId: string,
  memberNpub: string
): Promise<void> {
  dmLog('invite_member_to_group', { groupId: groupId.slice(0, 16) + '…', memberNpub: memberNpub.slice(0, 20) + '…' });
  await invoke('invite_member_to_group', {
    group_id: groupId,
    member_npub: memberNpub,
  });
  dmLog('invite_member_to_group done');
}

/**
 * Get members and admins of an MLS group. Backend: get_mls_group_members.
 */
export async function getMlsGroupMembers(groupId: string): Promise<MlsGroupMembers> {
  dmLog('get_mls_group_members', { groupId: groupId.slice(0, 16) + '…' });
  const result = (await invoke('get_mls_group_members', { group_id: groupId })) as MlsGroupMembers;
  dmLog('get_mls_group_members result', { members: result.members?.length ?? 0 });
  return result;
}

/**
 * Leave an MLS group. Backend: leave_mls_group.
 */
export async function leaveMlsGroup(groupId: string): Promise<void> {
  dmLog('leave_mls_group', { groupId: groupId.slice(0, 16) + '…' });
  await invoke('leave_mls_group', { group_id: groupId });
  dmLog('leave_mls_group done');
}

/**
 * Sync MLS groups (fetch new messages). Backend: sync_mls_groups_now.
 * Pass groupId to sync only that group, or null to sync all.
 */
export async function syncMlsGroupsNow(groupId?: string | null): Promise<{ synced: number; total: number }> {
  dmLog('sync_mls_groups_now', { groupId: groupId ?? '(all)' });
  const [synced, total] = (await invoke('sync_mls_groups_now', {
    group_id: groupId ?? null,
  })) as [number, number];
  dmLog('sync_mls_groups_now result', { synced, total });
  return { synced, total };
}
