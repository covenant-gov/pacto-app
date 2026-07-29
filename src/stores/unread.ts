import { derived, get, writable } from 'svelte/store';
import { getUnreadCounts } from '../lib/api/notifications';
import {
  dmList,
  dmSidebarCategoryForNpub,
  pendingList,
  pinnedList,
  requestsList,
} from './dm';

export { dmSidebarCategoryForNpub };

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

/** True while the open thread's message scroller is pinned to the bottom. */
export const dmThreadScrolledToBottom = writable(false);

/** Tab dot: set when any chat in that tab's membership has a nonzero backend count. */
export const dmTabHasUnread = derived(
  [unreadCountsByChat, pinnedList, dmList, requestsList, pendingList],
  ([$counts, $pinned, $friends, $requests, $pending]) => ({
    pinned: $pinned.some((e) => ($counts[e.npub] ?? 0) > 0),
    friends: $friends.some((e) => ($counts[e.npub] ?? 0) > 0),
    requests: $requests.some((e) => ($counts[e.npub] ?? 0) > 0),
    pending: $pending.some((e) => ($counts[e.npub] ?? 0) > 0),
  }),
);
