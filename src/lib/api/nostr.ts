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
 * Call after login so DMs are loaded from relays (per MESSAGING_OVERVIEW §8).
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
 * Call after init_finished so new messages arrive via push, not polling (per MESSAGING_OVERVIEW §9).
 */
export async function startNotifs(): Promise<boolean> {
  dmLog('notifs() starting live subscriptions');
  const ok = (await invoke('notifs')) as boolean;
  dmLog('notifs() done', ok);
  return ok;
}

/**
 * Get total message count for a DM chat (backend: get_chat_message_count).
 * Used for pagination / "load older" (DM_FLOW §4.3, §5.2).
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
 * Queue all profiles in backend state for sync from Nostr (PFP_FLOW §6.2).
 * Call after init_finished so contacts' names and PFPs fill in over time.
 * Backend: sync_all_profiles.
 */
export async function syncAllProfiles(): Promise<void> {
  dmLog('sync_all_profiles');
  await invoke('sync_all_profiles');
  dmLog('sync_all_profiles done');
}

/**
 * Update own profile and publish to Nostr (PFP_FLOW §4.5).
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
 * Upload avatar or banner image to Blossom; returns URL (PFP_FLOW §4.5).
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
 * Set local nickname for a contact (PFP_FLOW §5.4). Backend emits profile_nick_changed.
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
 * Notify the other party that we are typing (backend: start_typing). DM_FLOW §6.1 optional.
 */
export async function startTyping(receiver: string): Promise<boolean> {
  dmLog('start_typing', { receiver: receiver.slice(0, 20) + '…' });
  const ok = (await invoke('start_typing', { receiver })) as boolean;
  return ok;
}

/**
 * Mark a conversation as read up to a message (backend: mark_as_read).
 * DM_FLOW §5.2 optional. Pass last message id when opening or scrolling to bottom.
 */
export async function markAsRead(chatId: string, messageId: string | null): Promise<boolean> {
  dmLog('mark_as_read', { chatId: chatId.slice(0, 20) + '…', messageId: messageId?.slice(0, 12) ?? null });
  const ok = (await invoke('mark_as_read', { chatId, messageId })) as boolean;
  dmLog('mark_as_read result', ok);
  return ok;
}

/**
 * Send a DM to an npub (NIP-17 gift wrap). Calls backend message command.
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
