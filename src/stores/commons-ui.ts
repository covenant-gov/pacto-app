import { get, writable } from 'svelte/store';
import { fetchActiveUserCommonsBroadcast } from '../lib/commons/user-broadcast';

/** Personal broadcast modal open (sidebar + or in-view Start Broadcast). */
export const commonsBroadcastModalOpen = writable(false);

/** Bumped when the modal closes so Commons can refresh personal state / feed. */
export const commonsBroadcastModalClosedNonce = writable(0);

/** True while the signed-in user has a non-expired Commons user broadcast. */
export const commonsUserHasActiveBroadcast = writable(false);

export async function syncCommonsUserActiveBroadcast(npub: string | undefined): Promise<void> {
  if (!npub) {
    commonsUserHasActiveBroadcast.set(false);
    return;
  }
  const active = await fetchActiveUserCommonsBroadcast(npub);
  commonsUserHasActiveBroadcast.set(!!active);
}

export function openCommonsBroadcastModal(): void {
  if (get(commonsUserHasActiveBroadcast)) return;
  commonsBroadcastModalOpen.set(true);
}

export function closeCommonsBroadcastModal(): void {
  if (!get(commonsBroadcastModalOpen)) return;
  commonsBroadcastModalOpen.set(false);
  commonsBroadcastModalClosedNonce.update((n) => n + 1);
}
