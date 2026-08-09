import { get } from 'svelte/store';
import { deleteDmChatBackend } from '../api/nostr';
import { deleteDmChat, deletingDmNpubs } from '../../stores/dm';
import { mergeUnreadCounts } from '../../stores/unread';
import { showToast } from '../../stores/toast';

function setDeleting(npub: string, deleting: boolean): void {
  deletingDmNpubs.update((s) => {
    const next = new Set(s);
    if (deleting) next.add(npub);
    else next.delete(npub);
    return next;
  });
}

/** Backend delete first, then clear local UI. Non-blocking; tracks progress in deletingDmNpubs. */
export function startDeleteDmChat(npub: string): void {
  if (!npub || get(deletingDmNpubs).has(npub)) return;
  setDeleting(npub, true);
  void deleteDmChatBackend(npub)
    .then(() => {
      deleteDmChat(npub);
      mergeUnreadCounts({ [npub]: 0 });
    })
    .catch(() => {
      showToast('Could not delete chat. Please try again.');
    })
    .finally(() => {
      setDeleting(npub, false);
    });
}
