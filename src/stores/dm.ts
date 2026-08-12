import { writable, derived, get, type Readable } from 'svelte/store';
import type { RelayStatus } from '../lib/api/relays';
import { activeTopNavTab, activeView } from './navigation';
import type { SupportedChainId } from '../lib/wallet/chains';
import { persistenceKey } from './persistence-context';
import {
  initInviteDecisionPersistence,
} from './invite-decisions';

export type DmTab = 'friends' | 'requests' | 'pending' | 'search' | 'pinned';
export const activeDmTab = writable<DmTab>('friends');

export const PINNED_DM_NPUBS_PREFIX = 'pacto_pinned_dm_npubs';
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

/** Local block list (npubs hidden from DM sidebar; backend drops new incoming wraps after decrypt). */
export const blockedDmNpubs = writable<Set<string>>(new Set());

/** Peers with an in-flight backend DM delete (non-blocking UI). */
export const deletingDmNpubs = writable<Set<string>>(new Set());

export const composingNewChat = writable<boolean>(false);

export const NEW_CHAT_DRAFT_NPUB_PREFIX = 'pacto_new_chat_draft_npub';
export const NEW_CHAT_DRAFT_MESSAGE_PREFIX = 'pacto_new_chat_draft_message';

/** Prefill for the New Chat compose view (e.g. opened from a Commons user card). */
export const newChatDraftNpub = writable<string>('');
export const newChatDraftMessage = writable<string>('');

newChatDraftNpub.subscribe((npub) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(NEW_CHAT_DRAFT_NPUB_PREFIX);
  if (!key) return;
  try {
    if (npub) localStorage.setItem(key, npub);
    else localStorage.removeItem(key);
  } catch {
    // ignore quota
  }
});

newChatDraftMessage.subscribe((message) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(NEW_CHAT_DRAFT_MESSAGE_PREFIX);
  if (!key) return;
  try {
    if (message) localStorage.setItem(key, message);
    else localStorage.removeItem(key);
  } catch {
    // ignore quota
  }
});

export const walletSidebarOpen = writable<boolean>(false);

export type WalletSendPrefillPayload = {
  targetNpub: string;
  network: SupportedChainId;
  asset: string;
  amount: string;
  requestId: string;
  requestMessageId: string;
};

export const walletSendPrefillFromRequest = writable<WalletSendPrefillPayload | null>(null);

export const dmWalletPeerExchangeTick = writable(0);

export interface DmEntry {
  npub: string;
  name?: string;
  avatar?: string;
}

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
  [dmChatsByNpub, pinnedDmNpubs, blockedDmNpubs] as const,
  ([$m, $pinned, $blocked]) =>
    toDmEntries(
      $m,
      (c) => c.hasFromMe && c.hasFromThem && !$pinned.has(c.npub) && !$blocked.has(c.npub)
    )
);

export const requestsList = derived([dmChatsByNpub, blockedDmNpubs] as const, ([$m, $blocked]) =>
  toDmEntries($m, (c) => !c.hasFromMe && c.hasFromThem && !$blocked.has(c.npub))
);

export const pendingList = derived([dmChatsByNpub, blockedDmNpubs] as const, ([$m, $blocked]) =>
  toDmEntries($m, (c) => c.hasFromMe && !c.hasFromThem && !$blocked.has(c.npub))
);

export const pinnedList = derived(
  [dmChatsByNpub, pinnedDmNpubs, blockedDmNpubs] as const,
  ([$m, $pinned, $blocked]) => {
    const set = $pinned;
    return toDmEntries($m, (c) => set.has(c.npub) && c.hasFromMe && c.hasFromThem && !$blocked.has(c.npub));
  }
);

export const allDmEntriesUnified = derived(
  [pinnedList, dmList, requestsList, pendingList, dmChatsByNpub] as const,
  ([$pinned, $friends, $requests, $pending, $chats]) => {
    const map = new Map<string, DmEntry>();
    for (const e of $pinned) map.set(e.npub, e);
    for (const e of $friends) {
      if (!map.has(e.npub)) map.set(e.npub, e);
    }
    for (const e of $requests) {
      if (!map.has(e.npub)) map.set(e.npub, e);
    }
    for (const e of $pending) {
      if (!map.has(e.npub)) map.set(e.npub, e);
    }
    return [...map.values()].sort(
      (a, b) => ($chats[b.npub]?.lastAt ?? 0) - ($chats[a.npub]?.lastAt ?? 0)
    );
  }
);

export type DmSidebarCategory = 'pinned' | 'friends' | 'requests' | 'pending';

export function dmSidebarCategoryForNpub(
  npub: string,
  chats: Record<string, DmChatState>,
  pinned: Set<string>
): DmSidebarCategory {
  const c = chats[npub];
  if (!c) return 'friends';
  if (pinned.has(npub) && c.hasFromMe && c.hasFromThem) return 'pinned';
  if (c.hasFromMe && c.hasFromThem) return 'friends';
  if (!c.hasFromMe && c.hasFromThem) return 'requests';
  return 'pending';
}

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

export function addPendingDm(npub: string): void {
  setDmChatState(npub, { hasFromMe: true, hasFromThem: false, lastAt: Math.floor(Date.now() / 1000) });
}

export interface AttachmentImageMeta {
  blurhash: string;
  width: number;
  height: number;
}

export interface Attachment {
  id: string;
  key: string;
  nonce: string;
  extension: string;
  url: string;
  /** Local file path when downloaded; may be empty until cached. */
  path: string;
  /** File size in bytes. */
  size: number;
  img_meta?: AttachmentImageMeta | null;
  /** True while the attachment is being downloaded. */
  downloading?: boolean;
  /** True once the attachment has been written locally. */
  downloaded?: boolean;
  /** Original file name from the sender, when supplied. Never the SHA-256 id. */
  file_name?: string | null;
}

export interface Reaction {
  id: string;
  /** The message/event id this reaction references. */
  reference_id: string;
  /** Nostr npub of the reaction author. */
  author_id: string;
  emoji: string;
}

export interface PreviewMetadata {
  domain: string;
  og_title?: string | null;
  og_description?: string | null;
  og_image?: string | null;
  og_url?: string | null;
  og_type?: string | null;
  title?: string | null;
  description?: string | null;
  favicon?: string | null;
}

export interface DmMessage {
  id: string;
  content: string;
  at: number;
  mine: boolean;
  virtual_bucket?: string | null;
  is_local_announcement?: boolean;
  npub?: string;
  pending?: boolean;
  failed?: boolean;
  replied_to?: string;
  replied_to_content?: string | null;
  replied_to_npub?: string | null;
  replied_to_has_attachment?: boolean | null;
  attachments?: Attachment[];
  reactions?: Reaction[];
  preview_metadata?: PreviewMetadata | null;
}

export interface DmChatSnapshot {
  chatState: DmChatState | undefined;
  messages: DmMessage[];
  messageCount: number | undefined;
  loadedOffset: number | undefined;
  wasPinned: boolean;
  wasActive: boolean;
}

export const activeDmId = writable<string | null>(null);

/** True when the DM wallet panel is actually rendered (open flag + valid DM context). */
export const dmWalletSidebarVisible = derived(
  [walletSidebarOpen, activeDmId, activeTopNavTab, activeView, activeDmTab, composingNewChat],
  ([$open, $dmId, $topNav, $view, $dmTab, $composing]) =>
    $open &&
    !!$dmId &&
    $topNav === 'dms' &&
    $view === 'hub' &&
    ($dmTab === 'friends' || $dmTab === 'pinned') &&
    !$composing,
);

export function toggleWalletSidebar(): void {
  walletSidebarOpen.set(!get(dmWalletSidebarVisible));
}

export function closeWalletSidebar(): void {
  walletSidebarOpen.set(false);
}

export const LAST_DM_NPUB_PREFIX = 'pacto_last_dm_npub';
activeDmId.subscribe((id) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_DM_NPUB_PREFIX);
  if (!key) return;
  if (id) localStorage.setItem(key, id);
  else localStorage.removeItem(key);
});

initInviteDecisionPersistence(persistenceKey);

export const lastOpenedDmByTab = writable<Record<DmTab, string | null>>({
  friends: null,
  requests: null,
  pending: null,
  search: null,
  pinned: null,
});

export const dmSendError = writable<string | null>(null);

export const backendDmMessages = writable<Record<string, DmMessage[]>>({});

export const dmThreadAnnouncementsByNpub = writable<Record<string, DmMessage[]>>({});

/** Optimistic outbound DM row (replaced on `message_new` when content matches). */
export function appendPendingOutboundDmMessage(npub: string, content: string): string {
  const trimmedNpub = npub.trim();
  const id = `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!trimmedNpub) return id;
  backendDmMessages.update((byNpub) => {
    const list = byNpub[trimmedNpub] ?? [];
    return {
      ...byNpub,
      [trimmedNpub]: [
        ...list,
        { id, content, at: Date.now(), mine: true, pending: true },
      ],
    };
  });
  return id;
}

export function removeOutboundDmMessage(npub: string, messageId: string): void {
  const trimmedNpub = npub.trim();
  if (!trimmedNpub || !messageId) return;
  backendDmMessages.update((byNpub) => {
    const list = byNpub[trimmedNpub];
    if (!list?.length) return byNpub;
    const next = list.filter((m) => m.id !== messageId);
    if (next.length === list.length) return byNpub;
    return { ...byNpub, [trimmedNpub]: next };
  });
}

export function patchOutboundDmMessage(
  npub: string,
  messageId: string,
  patch: Partial<Pick<DmMessage, 'content' | 'pending' | 'failed'>>,
): void {
  const trimmedNpub = npub.trim();
  if (!trimmedNpub || !messageId) return;
  backendDmMessages.update((byNpub) => {
    const list = byNpub[trimmedNpub];
    if (!list?.length) return byNpub;
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx === -1) return byNpub;
    const next = [...list];
    next[idx] = { ...next[idx]!, ...patch };
    return { ...byNpub, [trimmedNpub]: next };
  });
}

/** Patch every outbound wallet announcement row matching `tx_hash` (survives id replacement on relay). */
export function patchOutboundWalletTxByHash(
  npub: string,
  txHash: string,
  patch: Partial<Pick<DmMessage, 'content' | 'pending' | 'failed'>>,
): void {
  const trimmedNpub = npub.trim();
  const needle = txHash.trim().toLowerCase();
  if (!trimmedNpub || !needle.startsWith('0x')) return;
  backendDmMessages.update((byNpub) => {
    const list = byNpub[trimmedNpub];
    if (!list?.length) return byNpub;
    let changed = false;
    const next = list.map((m) => {
      if (!m.mine) return m;
      try {
        const parsed = JSON.parse(m.content ?? '') as { tx_hash?: string };
        if (typeof parsed.tx_hash !== 'string' || parsed.tx_hash.toLowerCase() !== needle) {
          return m;
        }
      } catch {
        return m;
      }
      changed = true;
      return { ...m, ...patch };
    });
    return changed ? { ...byNpub, [trimmedNpub]: next } : byNpub;
  });
}

export function appendDmThreadAnnouncement(npub: string, content: string): void {
  const trimmedNpub = npub.trim();
  if (!trimmedNpub) return;
  dmThreadAnnouncementsByNpub.update((m) => {
    const list = m[trimmedNpub] ?? [];
    const msg: DmMessage = {
      id: `local-announce-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      content,
      at: Date.now(),
      mine: true,
      is_local_announcement: true,
    };
    return { ...m, [trimmedNpub]: [...list, msg] };
  });
}

export const messageCountByChat = writable<Record<string, number>>({});

export const loadedOffsetByChat = writable<Record<string, number>>({});

export type SyncStatus = 'idle' | 'syncing' | 'finished' | 'behind' | 'stalled';
export const dmSyncStatus = writable<SyncStatus>('idle');

/** Wall-clock time of the most recent successful catch-up (`sync_finished`). Null until one succeeds this session. */
export const lastCatchUpSuccess = writable<number | null>(null);

export interface RelayHealthEntry {
  status: RelayStatus;
  /** From the user's relay list; disabled relays never contribute to `stalled`. */
  enabled: boolean;
  /** Wall-clock time this relay was last seen outside disconnected/terminated. */
  lastHealthyAt: number;
}

/** Per-relay connection status + last-healthy timestamp, keyed by relay URL. Seeded from listRelays(), kept live by relay_status_change. */
export const relayStatusByUrl = writable<Record<string, RelayHealthEntry>>({});

const DOWN_RELAY_STATUSES: Partial<Record<RelayStatus, true>> = {
  disconnected: true,
  terminated: true,
};
function isRelayDown(status: RelayStatus): boolean {
  return DOWN_RELAY_STATUSES[status] === true;
}

/** Seed relayStatusByUrl with a startup snapshot; relay_status_change only fires on transitions, not for relays already connected. */
export function seedRelayHealth(
  relays: Array<{ url: string; status: RelayStatus; enabled: boolean }>
): void {
  const now = Date.now();
  relayStatusByUrl.update((cur) => {
    const next = { ...cur };
    for (const r of relays) {
      const existing = next[r.url];
      next[r.url] = {
        status: r.status,
        enabled: r.enabled,
        lastHealthyAt: isRelayDown(r.status) ? (existing?.lastHealthyAt ?? 0) : now,
      };
    }
    return next;
  });
}

/** Apply a relay_status_change transition to the tracked per-relay health map. */
export function applyRelayStatusChange(url: string, status: RelayStatus): void {
  const now = Date.now();
  relayStatusByUrl.update((cur) => {
    const existing = cur[url];
    return {
      ...cur,
      [url]: {
        status,
        enabled: existing?.enabled ?? true,
        lastHealthyAt: isRelayDown(status) ? (existing?.lastHealthyAt ?? now) : now,
      },
    };
  });
}

/** Patch `enabled` on a tracked relay after a local Settings toggle, without waiting for a relogin/reseed. */
export function setRelayEnabledLocally(url: string, enabled: boolean): void {
  relayStatusByUrl.update((cur) => {
    const existing = cur[url];
    if (!existing) return cur;
    return {
      ...cur,
      [url]: {
        ...existing,
        enabled,
      },
    };
  });
}

const SYNC_BEHIND_THRESHOLD_MS = 5 * 60 * 1000;
const SYNC_STALL_RELAY_THRESHOLD_MS = 5 * 60 * 1000;
const SYNC_HEALTH_TICK_INTERVAL_MS = 30 * 1000;

/** Ticks periodically so dmSyncStatusEffective re-evaluates the 5-minute thresholds even with no new events. */
const syncHealthTick = writable(Date.now());
/** Handle from setInterval; aliased for readability. */
type SyncHealthTickerHandle = ReturnType<typeof setInterval>;
let syncHealthTickInterval: SyncHealthTickerHandle | null = null;

/** Start the periodic recompute tick for dmSyncStatusEffective. Idempotent; safe to call repeatedly (HMR, multiple mounts). */
export function installSyncHealthTicker(): () => void {
  if (syncHealthTickInterval === null) {
    syncHealthTickInterval = globalThis.setInterval(() => {
      syncHealthTick.set(Date.now());
    }, SYNC_HEALTH_TICK_INTERVAL_MS);
  }
  return () => {
    if (syncHealthTickInterval !== null) {
      clearInterval(syncHealthTickInterval);
      syncHealthTickInterval = null;
    }
  };
}

/**
 * dmSyncStatus layered with time-relative `behind`/`stalled`, derived from catch-up recency and
 * enabled-relay health. `behind`: no successful catch-up in the last 5 minutes (and not currently
 * syncing). `stalled`: `behind`, plus at least one enabled tracked relay has been
 * disconnected/terminated for more than 5 minutes. Auto-clears the moment `sync_finished` resets
 * `lastCatchUpSuccess`.
 */
export const dmSyncStatusEffective: Readable<SyncStatus> = derived(
  [dmSyncStatus, lastCatchUpSuccess, relayStatusByUrl, syncHealthTick],
  ([$status, $lastCatchUpSuccess, $relayStatusByUrl, $tick]) => {
    if ($status === 'syncing') return $status;
    const behind =
      $lastCatchUpSuccess === null || $tick - $lastCatchUpSuccess > SYNC_BEHIND_THRESHOLD_MS;
    if (!behind) return $status;
    const relayStalled = Object.values($relayStatusByUrl).some(
      (r) =>
        r.enabled &&
        isRelayDown(r.status) &&
        $tick - r.lastHealthyAt > SYNC_STALL_RELAY_THRESHOLD_MS
    );
    return relayStalled ? 'stalled' : 'behind';
  }
);

export const typingByChat = writable<Record<string, string[]>>({});

export function deleteDmChat(npub: string): void {
  // Clear selection first so open-conversation loads cannot keep a deleted peer selected.
  activeDmId.update((id) => (id === npub ? null : id));
  lastOpenedDmByTab.update((tabs) => {
    let changed = false;
    const next = { ...tabs };
    for (const key of Object.keys(next) as DmTab[]) {
      if (next[key] === npub) {
        next[key] = null;
        changed = true;
      }
    }
    return changed ? next : tabs;
  });
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
  typingByChat.update((by) => {
    if (!(npub in by)) return by;
    const next = { ...by };
    delete next[npub];
    return next;
  });
  dmThreadAnnouncementsByNpub.update((m) => {
    if (!(npub in m)) return m;
    const next = { ...m };
    delete next[npub];
    return next;
  });
}

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
  if (snapshot.wasActive) {
    activeDmId.set(npub);
  }
}
