import { writable, derived } from 'svelte/store';
import type { SupportedChainId } from '../lib/wallet/chains';
import type { PactoAppInboxEntry } from '../lib/pacto-app-inbox';
import {
  isPactoAppRoutableInviteContent,
  mergePactoAppInboxEntry,
  PACTO_APP_DM_THREAD_ID,
  resolveInviteInviterNpub,
  toPactoAppInboxEntry,
} from '../lib/pacto-app-inbox';
import { persistenceKey } from './persistence-context';
import {
  initInviteDecisionPersistence,
} from './invite-decisions';

export type { PactoAppInboxEntry };
export { PACTO_APP_DM_THREAD_ID, PACTO_APP_DISPLAY_NAME, isPactoAppThreadId } from '../lib/pacto-app-inbox';

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

export const composingNewChat = writable<boolean>(false);

/** Prefill for the New Chat compose view (e.g. opened from a Commons user card). */
export const newChatDraftNpub = writable<string>('');
export const newChatDraftMessage = writable<string>('');

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

export function toggleWalletSidebar(): void {
  walletSidebarOpen.update((open) => !open);
}

export function closeWalletSidebar(): void {
  walletSidebarOpen.set(false);
}

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
  if (npub === PACTO_APP_DM_THREAD_ID) return 'pinned';
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
}

export interface DmChatSnapshot {
  chatState: DmChatState | undefined;
  messages: DmMessage[];
  messageCount: number | undefined;
  loadedOffset: number | undefined;
  wasPinned: boolean;
}

export const activeDmId = writable<string | null>(null);

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

export const PACTO_APP_INBOX_PREFIX = 'pacto_app_inbox';

export const pactoAppInboxMessages = writable<PactoAppInboxEntry[]>([]);

pactoAppInboxMessages.subscribe((value) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PACTO_APP_INBOX_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota
  }
});

export function appendPactoAppInboxMessage(message: DmMessage, inviterNpub: string): void {
  const entry = toPactoAppInboxEntry(message, inviterNpub);
  pactoAppInboxMessages.update((list) => mergePactoAppInboxEntry(list, entry));
}

export function reconcilePeerThreadInvites(): void {
  let inboxSnapshot: PactoAppInboxEntry[] = [];
  pactoAppInboxMessages.update((list) => {
    inboxSnapshot = [...list];
    return list;
  });
  const peersEmptied: string[] = [];
  backendDmMessages.update((byNpub) => {
    const nextByNpub: Record<string, DmMessage[]> = {};
    for (const [peer, msgs] of Object.entries(byNpub)) {
      const kept: DmMessage[] = [];
      for (const m of msgs) {
        const content = m.content ?? '';
        if (isPactoAppRoutableInviteContent(content)) {
          if (!m.mine) {
            const entry = toPactoAppInboxEntry(
              m,
              resolveInviteInviterNpub(m, peer, content)
            );
            if (!inboxSnapshot.some((x) => x.id === entry.id)) {
              inboxSnapshot = mergePactoAppInboxEntry(inboxSnapshot, entry);
            }
          }
        } else {
          kept.push(m);
        }
      }
      if (kept.length > 0) {
        nextByNpub[peer] = kept;
      } else if (msgs.length > 0) {
        peersEmptied.push(peer);
      }
    }
    pactoAppInboxMessages.set(inboxSnapshot);
    return nextByNpub;
  });
  if (peersEmptied.length > 0) {
    dmChatsByNpub.update((map) => {
      const next = { ...map };
      for (const peer of peersEmptied) {
        delete next[peer];
      }
      return next;
    });
  }
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

export type SyncStatus = 'idle' | 'syncing' | 'finished';
export const dmSyncStatus = writable<SyncStatus>('idle');

export const typingByChat = writable<Record<string, string[]>>({});

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
