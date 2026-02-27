import { writable, derived, get } from 'svelte/store';
import type { PendingMlsWelcome } from '../lib/api/nostr';
import {
  initInviteDecisionPersistence,
  getInviteDecisionLoadEntries,
  acceptedSquadInviteIds,
  declinedSquadInviteIds,
  acceptedNetworkInviteIds,
  declinedNetworkInviteIds,
  acceptedChannelInviteMessageIds,
  declinedChannelInviteMessageIds,
} from './invite-decisions';

// Re-export invite decision stores for consumers (e.g. +page, clear-account-state)
export {
  acceptedSquadInviteIds,
  declinedSquadInviteIds,
  acceptedNetworkInviteIds,
  declinedNetworkInviteIds,
  acceptedChannelInviteMessageIds,
  declinedChannelInviteMessageIds,
};

/** Current npub for persistence: scoped localStorage keys use this. Set on login, cleared on logout. */
export const currentNpubForPersistence = writable<string | null>(null);

export function setCurrentNpubForPersistence(npub: string | null): void {
  currentNpubForPersistence.set(npub);
}

function persistenceKey(prefix: string): string | null {
  const npub = get(currentNpubForPersistence);
  return npub ? `${prefix}_${npub}` : null;
}

// Top navbar tab - determines what the side Navbar shows (DMs, Networks, Squads)
export type TopNavTab = 'dms' | 'networks' | 'squads';
export const activeTopNavTab = writable<TopNavTab>('squads');

// UI state stores - what's currently selected
export const activeSquadId = writable<string | null>(null);
export const activeChannelId = writable<string | null>(null);

// View state - which main view is active
export type ViewType = 'hub' | 'profile';
export const activeView = writable<ViewType>('hub');

// Members panel (right-hand bar in squad/network channel view): keep open across tab switches until user closes
export const showMembersPanel = writable<boolean>(false);

// DMs: which sub-tab (Friends, Requests, Pending, Pinned)
export type DmTab = 'friends' | 'requests' | 'pending' | 'pinned';
export const activeDmTab = writable<DmTab>('friends');

const PINNED_DM_NPUBS_PREFIX = 'pacto_pinned_dm_npubs';
export const pinnedDmNpubs = writable<Set<string>>(new Set());
pinnedDmNpubs.subscribe((set) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PINNED_DM_NPUBS_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
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
// Requests: they messaged us, we haven't replied. Includes invite-only DMs (squad/network/channel-in-squad) from non-friends.
export const requestsList = derived(dmChatsByNpub, ($m) =>
  toDmEntries($m, (c) => !c.hasFromMe && c.hasFromThem)
);
// Pending: we messaged them, they haven't replied. Includes conversations where we sent an invite and they haven't replied.
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

/** Snapshot of a DM chat state for revert after failed backend delete. */
export interface DmChatSnapshot {
  chatState: DmChatState | undefined;
  messages: DmMessage[];
  messageCount: number | undefined;
  loadedOffset: number | undefined;
  wasPinned: boolean;
}

/** Remove a DM chat locally (conversation + messages, unpin, clear selection if active). */
export function deleteDmChat(npub: string): void {
  dmChatsByNpub.update((m) => {
    const next = { ...m };
    delete next[npub];
    return next;
  });
  backendDmMessages.update((byNpub) => {
    const next = { ...byNpub };
    delete next[npub];
    return next;
  });
  messageCountByChat.update((m) => {
    const next = { ...m };
    delete next[npub];
    return next;
  });
  loadedOffsetByChat.update((m) => {
    const next = { ...m };
    delete next[npub];
    return next;
  });
  pinnedDmNpubs.update((s) => {
    if (!s.has(npub)) return s;
    const next = new Set(s);
    next.delete(npub);
    return next;
  });
  activeDmId.update((id) => (id === npub ? null : id));
}

/** Restore a DM chat from a snapshot (e.g. after backend delete failed). */
export function revertDmChat(npub: string, snapshot: DmChatSnapshot): void {
  if (snapshot.chatState) {
    dmChatsByNpub.update((m) => ({ ...m, [npub]: snapshot.chatState! }));
  }
  backendDmMessages.update((byNpub) => ({ ...byNpub, [npub]: snapshot.messages }));
  if (snapshot.messageCount !== undefined) {
    messageCountByChat.update((m) => ({ ...m, [npub]: snapshot.messageCount! }));
  }
  if (snapshot.loadedOffset !== undefined) {
    loadedOffsetByChat.update((m) => ({ ...m, [npub]: snapshot.loadedOffset! }));
  }
  if (snapshot.wasPinned) {
    pinnedDmNpubs.update((s) => new Set(s).add(npub));
  }
}

// Selected DM conversation (other user's npub)
export const activeDmId = writable<string | null>(null);

// Invite decision persistence wired from invite-decisions.ts
initInviteDecisionPersistence(persistenceKey);

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
  /** Id of the message this one replies to (backend: replied_to) */
  replied_to?: string;
  /** Plain text preview of replied-to message (backend: replied_to_content). Not parsed as Markdown. */
  replied_to_content?: string | null;
  /** Sender npub of replied-to message (backend: replied_to_npub) */
  replied_to_npub?: string | null;
  /** Whether replied-to message has attachment (backend: replied_to_has_attachment) */
  replied_to_has_attachment?: boolean | null;
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
// Channel = one MLS group. Identified by groupId only (backend uses group_id everywhere).
export interface Channel {
  name: string;
  groupId: string;
  order: number;
}

/** Canonical name for the first channel of every squad and network (announcements group). */
export const ANNOUNCEMENTS_CHANNEL_NAME = 'announcements';

/** Normalize a channel from storage (drops legacy `id` if present). */
function normalizeChannel(ch: { name: string; groupId: string; order: number }): Channel {
  return { name: ch.name, groupId: ch.groupId, order: ch.order };
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

// Network = same shape as Squad but formed from multiple squads; memberSquads used for heading sub-title.
export interface Network {
  id: string;
  name: string;
  iconUrl?: string;
  channels: Channel[];
  /** Squads that form this network (id + name at creation). Used for network heading sub-heading. */
  memberSquads: { id: string; name: string }[];
  createdAt: number;
  updatedAt: number;
}

const PACTO_SQUADS_PREFIX = 'pacto_squads';

export const squads = writable<Squad[]>([]);

squads.subscribe((value) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PACTO_SQUADS_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota or serialization errors
  }
});

const PACTO_NETWORKS_PREFIX = 'pacto_networks';

export const networks = writable<Network[]>([]);

networks.subscribe((value) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PACTO_NETWORKS_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota or serialization errors
  }
});

/** Returns true if the channel display name looks like a placeholder (e.g. truncated groupId). */
export function isPlaceholderChannelName(groupId: string, name: string): boolean {
  if (!name || name.length < 10) return false;
  const placeholder = groupId.slice(0, 12) + '…';
  return name === placeholder || name === groupId.slice(0, 12);
}

/**
 * If a channel with this groupId has a placeholder name (e.g. hash), update it to newName
 * in squads, networks, and ungroupedChannels. Only updates when current name is placeholder-like.
 */
export function updateChannelNameIfPlaceholder(groupId: string, newName: string): void {
  if (!newName || typeof newName !== 'string') return;
  const name = newName.trim();
  if (!name) return;

  squads.update((list) =>
    list.map((s) => ({
      ...s,
      channels: s.channels.map((ch) =>
        ch.groupId === groupId && isPlaceholderChannelName(groupId, ch.name)
          ? { ...ch, name }
          : ch
      ),
    }))
  );
  networks.update((list) =>
    list.map((n) => ({
      ...n,
      channels: n.channels.map((ch) =>
        ch.groupId === groupId && isPlaceholderChannelName(groupId, ch.name)
          ? { ...ch, name }
          : ch
      ),
    }))
  );
  ungroupedChannels.update((list) =>
    list.map((ch) =>
      ch.groupId === groupId && isPlaceholderChannelName(groupId, ch.name)
        ? { ...ch, name }
        : ch
    )
  );
}

// Backend-backed group messages (get_message_views(groupId) + mls_message_new). Keyed by group_id. Reuse DmMessage shape.
export const backendGroupMessages = writable<Record<string, DmMessage[]>>({});

export const groupSendError = writable<string | null>(null);

export const pendingMlsWelcomes = writable<PendingMlsWelcome[]>([]);

/** Parent ids (squad or network, temp or group id) that are optimistically created and still creating their announcements channel. Cleared on success/failure or logout. */
export const parentsCreatingAnnouncements = writable<Set<string>>(new Set());

export function addParentCreatingAnnouncements(id: string): void {
  parentsCreatingAnnouncements.update((s) => new Set(s).add(id));
}
export function removeParentCreatingAnnouncements(id: string): void {
  parentsCreatingAnnouncements.update((s) => {
    const next = new Set(s);
    next.delete(id);
    return next;
  });
}

/** Error message per parent id when optimistic creation (announcements) failed. Cleared on retry/success or logout. */
export const parentCreateErrorById = writable<Record<string, string>>({});
/** Member npubs per parent id for parents still creating announcements; used for retry. Cleared on success or logout. */
export const parentPendingCreateMembers = writable<Record<string, string[]>>({});

export const ungroupedChannels = writable<Channel[]>([]);

// Legacy: channelMessages was keyed by groupId for local-only mock. Replaced by backendGroupMessages keyed by groupId.
export const channelMessages = writable<Record<string, any[]>>({});

// Persist last open DM for restore on next app open (npub-scoped)
const LAST_DM_NPUB_PREFIX = 'pacto_last_dm_npub';
activeDmId.subscribe((id) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_DM_NPUB_PREFIX);
  if (!key) return;
  if (id) localStorage.setItem(key, id);
  else localStorage.removeItem(key);
});

// Last opened squad/channel for restore when switching to Squads view (npub-scoped)
const LAST_SQUAD_ID_PREFIX = 'pacto_last_squad_id';
const LAST_CHANNEL_ID_PREFIX = 'pacto_last_channel_id';
// Per-squad last channel (squadId -> channelId) so returning to a squad restores its channel
const LAST_CHANNEL_BY_SQUAD_PREFIX = 'pacto_last_channel_by_squad';

export const lastOpenedSquadId = writable<string | null>(null);
export const lastOpenedChannelId = writable<string | null>(null);
export const lastChannelBySquadId = writable<Record<string, string>>({});

lastOpenedSquadId.subscribe((id) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_SQUAD_ID_PREFIX);
  if (!key) return;
  if (id) localStorage.setItem(key, id);
  else localStorage.removeItem(key);
});
lastOpenedChannelId.subscribe((id) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_CHANNEL_ID_PREFIX);
  if (!key) return;
  if (id) localStorage.setItem(key, id);
  else localStorage.removeItem(key);
});
lastChannelBySquadId.subscribe((map) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_CHANNEL_BY_SQUAD_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore quota
  }
});

// Last opened network/channel for restore when switching to Networks view (npub-scoped)
const LAST_NETWORK_ID_PREFIX = 'pacto_last_network_id';
const LAST_NETWORK_CHANNEL_ID_PREFIX = 'pacto_last_network_channel_id';
// Per-network last channel (networkId -> channelId) so returning to a network restores its channel
const LAST_CHANNEL_BY_NETWORK_PREFIX = 'pacto_last_channel_by_network';

export const activeNetworkId = writable<string | null>(null);
export const lastOpenedNetworkId = writable<string | null>(null);
export const lastOpenedNetworkChannelId = writable<string | null>(null);
export const lastChannelByNetworkId = writable<Record<string, string>>({});

/** Monotonic version per MLS group id; increments when backend signals membership changes. */
export const membershipVersionByGroupId = writable<Record<string, number>>({});

export function bumpMembershipVersion(groupId: string): void {
  membershipVersionByGroupId.update((map) => ({
    ...map,
    [groupId]: (map[groupId] ?? 0) + 1,
  }));
}

lastOpenedNetworkId.subscribe((id) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_NETWORK_ID_PREFIX);
  if (!key) return;
  if (id) localStorage.setItem(key, id);
  else localStorage.removeItem(key);
});
lastOpenedNetworkChannelId.subscribe((id) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_NETWORK_CHANNEL_ID_PREFIX);
  if (!key) return;
  if (id) localStorage.setItem(key, id);
  else localStorage.removeItem(key);
});
lastChannelByNetworkId.subscribe((map) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_CHANNEL_BY_NETWORK_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore quota
  }
});

/** Load account-specific state from localStorage for the given npub. Call after login/create/import/unlock. */
export function loadAccountState(npub: string): void {
  setCurrentNpubForPersistence(npub);
  if (typeof localStorage === 'undefined') return;
  try {
    const squadsKey = `${PACTO_SQUADS_PREFIX}_${npub}`;
    const rawSquads = localStorage.getItem(squadsKey);
    if (rawSquads) {
      const parsed = JSON.parse(rawSquads) as unknown;
      const list = Array.isArray(parsed) ? (parsed as Squad[]) : [];
      squads.set(
        list.map((s) => ({ ...s, channels: s.channels.map(normalizeChannel) }))
      );
    }
    const pinnedKey = `${PINNED_DM_NPUBS_PREFIX}_${npub}`;
    const rawPinned = localStorage.getItem(pinnedKey);
    if (rawPinned) {
      const parsed = JSON.parse(rawPinned) as unknown;
      const arr = Array.isArray(parsed) ? (parsed as string[]).filter((x) => typeof x === 'string') : [];
      pinnedDmNpubs.set(new Set(arr));
    }
    const lastDm = localStorage.getItem(`${LAST_DM_NPUB_PREFIX}_${npub}`)?.trim();
    if (lastDm) activeDmId.set(lastDm);
    const lastSquad = localStorage.getItem(`${LAST_SQUAD_ID_PREFIX}_${npub}`);
    if (lastSquad) lastOpenedSquadId.set(lastSquad);
    const lastChannel = localStorage.getItem(`${LAST_CHANNEL_ID_PREFIX}_${npub}`);
    if (lastChannel) lastOpenedChannelId.set(lastChannel);
    const rawBySquad = localStorage.getItem(`${LAST_CHANNEL_BY_SQUAD_PREFIX}_${npub}`);
    if (rawBySquad) {
      try {
        const parsed = JSON.parse(rawBySquad) as unknown;
        lastChannelBySquadId.set(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {});
      } catch {
        lastChannelBySquadId.set({});
      }
    }
    const rawNetworks = localStorage.getItem(`${PACTO_NETWORKS_PREFIX}_${npub}`);
    if (rawNetworks) {
      const parsed = JSON.parse(rawNetworks) as unknown;
      const list = Array.isArray(parsed) ? (parsed as Network[]) : [];
      networks.set(
        list.map((n) => ({ ...n, channels: n.channels.map(normalizeChannel) }))
      );
    }
    const lastNetwork = localStorage.getItem(`${LAST_NETWORK_ID_PREFIX}_${npub}`);
    if (lastNetwork) lastOpenedNetworkId.set(lastNetwork);
    const lastNetworkChannel = localStorage.getItem(`${LAST_NETWORK_CHANNEL_ID_PREFIX}_${npub}`);
    if (lastNetworkChannel) lastOpenedNetworkChannelId.set(lastNetworkChannel);
    const rawByNetwork = localStorage.getItem(`${LAST_CHANNEL_BY_NETWORK_PREFIX}_${npub}`);
    if (rawByNetwork) {
      try {
        const parsed = JSON.parse(rawByNetwork) as unknown;
        lastChannelByNetworkId.set(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {});
      } catch {
        lastChannelByNetworkId.set({});
      }
    }
    for (const [key, setStore] of getInviteDecisionLoadEntries(npub)) {
      try {
        const raw = localStorage.getItem(key);
        const arr = raw ? (JSON.parse(raw) as unknown) : [];
        setStore(Array.isArray(arr) ? (arr as string[]).filter((x) => typeof x === 'string') : []);
      } catch {
        setStore([]);
      }
    }
  } catch {
    // ignore parse errors
  }
}

