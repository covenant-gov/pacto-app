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
 * Send a DM to an npub (NIP-17 gift wrap). Calls backend message command.
 */
export async function sendDmMessage(
  receiver: string,
  content: string,
  repliedTo: string = ''
): Promise<boolean> {
  dmLog('message (send DM)', { receiver: receiver.slice(0, 20) + '…', contentLen: content.length, repliedTo: repliedTo || '(none)' });
  const ok = await invoke('message', {
    receiver,
    content,
    repliedTo,
    file: null,
  }) as boolean;
  dmLog('message result', { ok });
  return ok;
}
