import { writable } from 'svelte/store';

// Top navbar tab - determines what the side Navbar shows (DMs, Networks, Squads)
export type TopNavTab = 'dms' | 'networks' | 'squads';
export const activeTopNavTab = writable<TopNavTab>('dms');

// UI state stores - what's currently selected
export const activeSquadId = writable<string | null>(null);
export const activeChannelId = writable<string | null>(null);

// View state - which main view is active
export type ViewType = 'hub' | 'profile';
export const activeView = writable<ViewType>('hub');

// DMs: which sub-tab (Friends, Requests, Pending)
export type DmTab = 'friends' | 'requests' | 'pending';
export const activeDmTab = writable<DmTab>('friends');

// New Chat flow: when true, show npub + message form instead of DM list/thread
export const composingNewChat = writable<boolean>(false);

// DM list for MessengerNavbar - will be populated from backend chats
export interface DmEntry {
  npub: string;
  name?: string;
  avatar?: string;
}
export const dmList = writable<DmEntry[]>([]);
// Pending DMs (we sent first, not yet in friends) - will be populated when backend has initiated_by
export const pendingList = writable<DmEntry[]>([]);
// Request DMs (they sent first, not in friends) - will be populated when backend has initiated_by
export const requestsList = writable<DmEntry[]>([]);

// Selected DM conversation (other user's npub)
export const activeDmId = writable<string | null>(null);

// DM send error (shown in thread; set by both thread send and new-chat send)
export const dmSendError = writable<string | null>(null);

// DM message shape (matches backend Message for id, content, at, mine; used for display)
export interface DmMessage {
  id: string;
  content: string;
  at: number;
  mine: boolean;
  npub?: string;
  pending?: boolean;
  failed?: boolean;
}

// Backend DM messages (from get_message_views + message_new). Keyed by npub.
export const backendDmMessages = writable<Record<string, DmMessage[]>>({});

// Total message count per chat (from get_chat_message_count when opening a DM). Used for "load older" pagination.
export const messageCountByChat = writable<Record<string, number>>({});

// Offset already loaded per chat for "load older" (get_message_views offset). After first page (e.g. 100), next load uses this.
export const loadedOffsetByChat = writable<Record<string, number>>({});

// DM historical sync status (DM_FLOW §3.1 optional UI). 'finished' shows "Up to date" briefly then resets to 'idle'.
export type SyncStatus = 'idle' | 'syncing' | 'finished';
export const dmSyncStatus = writable<SyncStatus>('idle');

// Typing indicators per chat (npub → list of npubs currently typing). DM_FLOW §6.1.
export const typingByChat = writable<Record<string, string[]>>({});

// Squads store - will be populated from Nostr relay data
export const squads = writable<any[]>([]);

// Messages store organized by channelId - will be populated from Nostr relay data
export const channelMessages = writable<Record<string, any[]>>({});

// Persist last open DM for restore on next app open (DM_FLOW §8.2)
const LAST_DM_NPUB_KEY = 'pacto_last_dm_npub';
activeDmId.subscribe((id) => {
  if (id && typeof localStorage !== 'undefined') {
    localStorage.setItem(LAST_DM_NPUB_KEY, id);
  }
});

