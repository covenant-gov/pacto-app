import { derived, get, writable } from 'svelte/store';
import { getUnreadCounts } from '../lib/api/notifications';
import {
  dmList,
  dmSidebarCategoryForNpub,
  pactoAppInboxMessages,
  pendingList,
  pinnedList,
  requestsList,
} from './dm';
import { persistenceKey } from './persistence-context';

export { dmSidebarCategoryForNpub };

export const PACTO_APP_INBOX_LAST_READ_PREFIX = 'pacto_app_inbox_last_read';

/**
 * Backend-owned per-chat unread map (R14/R15) — keyed by npub for DMs and by
 * MLS group id for squad channels. The backend already applies each chat's
 * notification level and blocked-peer skips, so every badge surface reads
 * this map directly; nothing here recomputes a count from a message array.
 * Hydrated once via `hydrateUnreadCounts()`, then merged (never replaced) as
 * `unread_counts_changed` events arrive.
 */
export const unreadCountsByChat = writable<Record<string, number>>({});

/** One-shot hydrate; call once the chat list is known to exist (e.g. on `init_finished`). */
export async function hydrateUnreadCounts(): Promise<void> {
  unreadCountsByChat.set(await getUnreadCounts());
}

/**
 * Merges a partial `unread_counts_changed` payload into the store. A `0` entry
 * means that chat's count dropped to zero (or the chat was removed); every
 * other chat already in the store is left untouched.
 */
export function mergeUnreadCounts(changed: Record<string, number>): void {
  unreadCountsByChat.update((m) => ({ ...m, ...changed }));
}

export function unreadCountForChat(chatId: string): number {
  return get(unreadCountsByChat)[chatId] ?? 0;
}

/** Logout / account switch: drop the cached map until the next account re-hydrates it. */
export function resetUnreadStore(): void {
  unreadCountsByChat.set({});
}

/** Last read message id for the synthetic, local-only "Pacto App" inbox thread. */
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

/**
 * Reverse-walk newest → oldest, stop at own message or last-read id. The Pacto
 * App inbox is a synthetic, local-only thread the backend has no concept of —
 * unlike every real chat it has no backend count to mirror, so this is the one
 * remaining message-array-derived count.
 */
function countUnreadPactoAppInboxMessages(
  messages: ReadonlyArray<{ id: string; mine?: boolean }>,
  lastReadId: string,
): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.mine) break;
    if (lastReadId && msg.id === lastReadId) break;
    count++;
  }
  return count;
}

export const pactoAppInboxUnreadCount = derived(
  [pactoAppInboxMessages, pactoAppInboxLastReadId],
  ([$msgs, $lastRead]) => countUnreadPactoAppInboxMessages($msgs, $lastRead),
);

export function clearPactoAppInboxUnread(lastMessageId: string): void {
  pactoAppInboxLastReadId.set(lastMessageId);
}

/** Tab dot: set when any chat in that tab's membership has a nonzero backend count. */
export const dmTabHasUnread = derived(
  [unreadCountsByChat, pactoAppInboxUnreadCount, pinnedList, dmList, requestsList, pendingList],
  ([$counts, $inboxUnread, $pinned, $friends, $requests, $pending]) => ({
    pinned: $inboxUnread > 0 || $pinned.some((e) => ($counts[e.npub] ?? 0) > 0),
    friends: $friends.some((e) => ($counts[e.npub] ?? 0) > 0),
    requests: $requests.some((e) => ($counts[e.npub] ?? 0) > 0),
    pending: $pending.some((e) => ($counts[e.npub] ?? 0) > 0),
  }),
);
