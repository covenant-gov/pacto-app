import { writable, derived } from 'svelte/store';
import type { PendingMlsWelcome } from '../lib/api/nostr';

// Top navbar tab - determines what the side Navbar shows (DMs, Networks, Squads)
export type TopNavTab = 'dms' | 'networks' | 'squads';
export const activeTopNavTab = writable<TopNavTab>('squads');

// UI state stores - what's currently selected
export const activeSquadId = writable<string | null>(null);
export const activeChannelId = writable<string | null>(null);

// View state - which main view is active
export type ViewType = 'hub' | 'profile';
export const activeView = writable<ViewType>('hub');

// DMs: which sub-tab (Friends, Requests, Pending, Pinned)
export type DmTab = 'friends' | 'requests' | 'pending' | 'pinned';
export const activeDmTab = writable<DmTab>('friends');

const PINNED_DM_NPUBS_KEY = 'pacto_pinned_dm_npubs';
function loadPinnedDmNpubs(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PINNED_DM_NPUBS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]).filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
export const pinnedDmNpubs = writable<Set<string>>(new Set(loadPinnedDmNpubs()));
pinnedDmNpubs.subscribe((set) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PINNED_DM_NPUBS_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
});

// New Chat flow: when true, show npub + message form instead of DM list/thread
export const composingNewChat = writable<boolean>(false);

// DM entry for display in the sidebar
export interface DmEntry {
  npub: string;
  name?: string;
  avatar?: string;
}

// Single source of truth: who has sent messages → Friends (2-way), Requests (they only), Pending (we only)
export interface DmChatState {
  npub: string;
  name?: string;
  avatar?: string;
  hasFromMe: boolean;
  hasFromThem: boolean;
  lastAt: number;
}

export const dmChatsByNpub = writable<Record<string, DmChatState>>({});

function toDmEntries(map: Record<string, DmChatState>, filter: (c: DmChatState) => boolean): DmEntry[] {
  return Object.values(map)
    .filter(filter)
    .sort((a, b) => b.lastAt - a.lastAt)
    .map((c) => ({ npub: c.npub, name: c.name, avatar: c.avatar }));
}

export const dmList = derived(
  [dmChatsByNpub, pinnedDmNpubs] as const,
  ([$m, $pinned]) =>
    toDmEntries($m, (c) => c.hasFromMe && c.hasFromThem && !$pinned.has(c.npub))
);
export const requestsList = derived(dmChatsByNpub, ($m) =>
  toDmEntries($m, (c) => !c.hasFromMe && c.hasFromThem)
);
export const pendingList = derived(dmChatsByNpub, ($m) =>
  toDmEntries($m, (c) => c.hasFromMe && !c.hasFromThem)
);

export const pinnedList = derived(
  [dmChatsByNpub, pinnedDmNpubs] as const,
  ([$m, $pinned]) => {
    const set = $pinned;
    return toDmEntries($m, (c) => set.has(c.npub) && c.hasFromMe && c.hasFromThem);
  }
);

/** Add/update a DM in the map. */
export function setDmChatState(
  npub: string,
  update: Partial<Omit<DmChatState, 'npub'>> & { npub?: string }
): void {
  dmChatsByNpub.update((m) => {
    const cur = m[npub];
    const next: DmChatState = {
      npub,
      name: update.name ?? cur?.name,
      avatar: update.avatar ?? cur?.avatar,
      hasFromMe: update.hasFromMe ?? cur?.hasFromMe ?? false,
      hasFromThem: update.hasFromThem ?? cur?.hasFromThem ?? false,
      lastAt: update.lastAt ?? cur?.lastAt ?? 0,
    };
    return { ...m, [npub]: next };
  });
}

/** When we send first message to a new npub → appears in Pending until they reply. */
export function addPendingDm(npub: string): void {
  setDmChatState(npub, { hasFromMe: true, hasFromThem: false, lastAt: Math.floor(Date.now() / 1000) });
}

// Selected DM conversation (other user's npub)
export const activeDmId = writable<string | null>(null);

// Last opened chat per tab (Friends / Requests / Pending / Pinned) so switching tabs shows that chat if still in section
export const lastOpenedDmByTab = writable<Record<DmTab, string | null>>({
  friends: null,
  requests: null,
  pending: null,
  pinned: null,
});

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

// DM historical sync status. 'finished' shows "Up to date" briefly then resets to 'idle'.
export type SyncStatus = 'idle' | 'syncing' | 'finished';
export const dmSyncStatus = writable<SyncStatus>('idle');

// Typing indicators per chat (npub → list of npubs currently typing).
export const typingByChat = writable<Record<string, string[]>>({});

// --- MLS / Squads ---
// Channel = one MLS group. id === groupId for simplicity (backend uses group_id everywhere).
export interface Channel {
  id: string;
  name: string;
  groupId: string;
  order: number;
}

// Squad = frontend-only container (name, icon, ordered channels). Persisted to localStorage.
export interface Squad {
  id: string;
  name: string;
  iconUrl?: string;
  channels: Channel[];
  createdAt: number;
  updatedAt: number;
}

const PACTO_SQUADS_KEY = 'pacto_squads';

function loadSquadsFromStorage(): Squad[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PACTO_SQUADS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as Squad[];
  } catch {
    return [];
  }
}

export const squads = writable<Squad[]>(loadSquadsFromStorage());

squads.subscribe((value) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PACTO_SQUADS_KEY, JSON.stringify(value));
  } catch {
    // ignore quota or serialization errors
  }
});

// Backend-backed group messages (get_message_views(groupId) + mls_message_new). Keyed by group_id. Reuse DmMessage shape.
export const backendGroupMessages = writable<Record<string, DmMessage[]>>({});

export const groupSendError = writable<string | null>(null);

export const pendingMlsWelcomes = writable<PendingMlsWelcome[]>([]);

export const ungroupedChannels = writable<Channel[]>([]);

// Legacy: channelMessages was keyed by channel id for local-only mock. Replaced by backendGroupMessages keyed by groupId.
export const channelMessages = writable<Record<string, any[]>>({});

// Persist last open DM for restore on next app open
const LAST_DM_NPUB_KEY = 'pacto_last_dm_npub';
activeDmId.subscribe((id) => {
  if (id && typeof localStorage !== 'undefined') {
    localStorage.setItem(LAST_DM_NPUB_KEY, id);
  }
});

// Last opened squad/channel for restore when switching to Squads view (like DMs)
const LAST_SQUAD_ID_KEY = 'pacto_last_squad_id';
const LAST_CHANNEL_ID_KEY = 'pacto_last_channel_id';

function loadLastSquadId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(LAST_SQUAD_ID_KEY);
  } catch {
    return null;
  }
}
function loadLastChannelId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(LAST_CHANNEL_ID_KEY);
  } catch {
    return null;
  }
}

export const lastOpenedSquadId = writable<string | null>(loadLastSquadId());
export const lastOpenedChannelId = writable<string | null>(loadLastChannelId());

lastOpenedSquadId.subscribe((id) => {
  if (typeof localStorage !== 'undefined') {
    if (id) localStorage.setItem(LAST_SQUAD_ID_KEY, id);
    else localStorage.removeItem(LAST_SQUAD_ID_KEY);
  }
});
lastOpenedChannelId.subscribe((id) => {
  if (typeof localStorage !== 'undefined') {
    if (id) localStorage.setItem(LAST_CHANNEL_ID_KEY, id);
    else localStorage.removeItem(LAST_CHANNEL_ID_KEY);
  }
});

