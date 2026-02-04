import { writable } from 'svelte/store';

// Top navbar tab - determines what the side Navbar shows (DMs, Networks, Communities)
export type TopNavTab = 'dms' | 'networks' | 'communities';
export const activeTopNavTab = writable<TopNavTab>('dms');

// UI state stores - what's currently selected
export const activeCommunityId = writable<string | null>(null);
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

// Backend DM messages (from get_chat_messages_paginated + message_new). Keyed by npub.
export const backendDmMessages = writable<Record<string, DmMessage[]>>({});

// Communities store - will be populated from Nostr relay data
export const communities = writable<any[]>([]);

// Messages store organized by channelId - will be populated from Nostr relay data
export const channelMessages = writable<Record<string, any[]>>({});

