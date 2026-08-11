import { get } from 'svelte/store';
import { deleteDmChatBackend } from '../api/nostr';
import {
  activeDmId,
  backendDmMessages,
  deleteDmChat,
  deletingDmNpubs,
  dmChatsByNpub,
  loadedOffsetByChat,
  messageCountByChat,
  pinnedDmNpubs,
  revertDmChat,
  type DmChatSnapshot,
} from '../../stores/dm';
import { mergeUnreadCounts, unreadCountsByChat } from '../../stores/unread';
import { showToast } from '../../stores/toast';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import { t } from 'svelte-i18n';

function setDeleting(npub: string, deleting: boolean): void {
  deletingDmNpubs.update((s) => {
    const next = new Set(s);
    if (deleting) next.add(npub);
    else next.delete(npub);
    return next;
  });
}

function snapshotDmChat(npub: string): DmChatSnapshot {
  return {
    chatState: get(dmChatsByNpub)[npub],
    messages: get(backendDmMessages)[npub] ?? [],
    messageCount: get(messageCountByChat)[npub],
    loadedOffset: get(loadedOffsetByChat)[npub],
    wasPinned: get(pinnedDmNpubs).has(npub),
    wasActive: get(activeDmId) === npub,
  };
}

function isAlreadyGoneError(err: unknown): boolean {
  return getInvokeErrorMessage(err, '').includes('Chat not found');
}

/** Clear Friends immediately; durable purge runs in the background. Revert only on unexpected failure. */
export function startDeleteDmChat(npub: string): void {
  if (!npub || get(deletingDmNpubs).has(npub)) return;
  setDeleting(npub, true);

  const snapshot = snapshotDmChat(npub);
  const previousUnread = get(unreadCountsByChat)[npub] ?? 0;

  deleteDmChat(npub);
  mergeUnreadCounts({ [npub]: 0 });

  void deleteDmChatBackend(npub)
    .catch((err) => {
      if (isAlreadyGoneError(err)) return;
      revertDmChat(npub, snapshot);
      if (previousUnread > 0) mergeUnreadCounts({ [npub]: previousUnread });
      showToast(get(t)('messaging.dm.thread.deleteFailed'));
    })
    .finally(() => {
      setDeleting(npub, false);
    });
}
