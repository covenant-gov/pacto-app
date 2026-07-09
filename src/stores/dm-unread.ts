import { derived, get, writable } from 'svelte/store';
import { countUnreadInThread } from '../lib/dm/dm-unread';
import {
  PACTO_APP_DM_THREAD_ID,
  pactoAppInboxMessages,
  dmList,
  pendingList,
  pinnedList,
  requestsList,
  dmSidebarCategoryForNpub,
} from './dm';
import { persistenceKey } from './persistence-context';

export const PACTO_APP_INBOX_LAST_READ_PREFIX = 'pacto_app_inbox_last_read';

/** Last read message id per peer npub (mirrors backend `last_read` after scroll-to-bottom). */
export const dmLastReadByNpub = writable<Record<string, string>>({});

/** Unread counts per peer npub (may exceed loaded message window until thread is opened). */
export const dmUnreadByNpub = writable<Record<string, number>>({});

export const pactoAppInboxLastReadId = writable<string>('');

pactoAppInboxLastReadId.subscribe((id) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PACTO_APP_INBOX_LAST_READ_PREFIX);
  if (!key) return;
  try {
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
});

/** True while the open thread's message scroller is pinned to the bottom. */
export const dmThreadScrolledToBottom = writable(false);

export const pactoAppInboxUnreadCount = derived(
  [pactoAppInboxMessages, pactoAppInboxLastReadId],
  ([$msgs, $lastRead]) => countUnreadInThread($msgs, $lastRead),
);

export const dmTabHasUnread = derived(
  [dmUnreadByNpub, pactoAppInboxUnreadCount, pinnedList, dmList, requestsList, pendingList],
  ([$unread, $inboxUnread, $pinned, $friends, $requests, $pending]) => ({
    pinned:
      $inboxUnread > 0 || $pinned.some((e) => ($unread[e.npub] ?? 0) > 0),
    friends: $friends.some((e) => ($unread[e.npub] ?? 0) > 0),
    requests: $requests.some((e) => ($unread[e.npub] ?? 0) > 0),
    pending: $pending.some((e) => ($unread[e.npub] ?? 0) > 0),
  }),
);

export function unreadCountForNpub(npub: string): number {
  return get(dmUnreadByNpub)[npub] ?? 0;
}

export function hydrateDmUnreadFromInitChats(
  chats: Array<{
    id: string;
    last_read?: string;
    messages?: Array<{ id: string; mine?: boolean }>;
  }>,
): void {
  const lastRead: Record<string, string> = {};
  const unread: Record<string, number> = {};
  for (const c of chats) {
    if (!c.id.startsWith('npub1')) continue;
    const lr = c.last_read?.trim() ?? '';
    if (lr) lastRead[c.id] = lr;
    unread[c.id] = countUnreadInThread(c.messages ?? [], lr);
  }
  dmLastReadByNpub.set(lastRead);
  dmUnreadByNpub.set(unread);
}

export function syncUnreadCountForNpub(npub: string, messages: ReadonlyArray<{ id: string; mine?: boolean }>): void {
  const lastRead = get(dmLastReadByNpub)[npub] ?? '';
  const count = countUnreadInThread(messages, lastRead);
  dmUnreadByNpub.update((m) => ({ ...m, [npub]: count }));
}

export function incrementDmUnread(npub: string): void {
  dmUnreadByNpub.update((m) => ({ ...m, [npub]: (m[npub] ?? 0) + 1 }));
}

export function clearDmUnread(npub: string, lastMessageId: string): void {
  dmLastReadByNpub.update((m) => ({ ...m, [npub]: lastMessageId }));
  dmUnreadByNpub.update((m) => ({ ...m, [npub]: 0 }));
}

export function clearPactoAppInboxUnread(lastMessageId: string): void {
  pactoAppInboxLastReadId.set(lastMessageId);
}

export function unreadCountForSidebarEntry(
  npub: string,
  _chats: Record<string, unknown>,
  _pinned: Set<string>,
): number {
  if (npub === PACTO_APP_DM_THREAD_ID) return get(pactoAppInboxUnreadCount);
  return unreadCountForNpub(npub);
}

export { dmSidebarCategoryForNpub };
