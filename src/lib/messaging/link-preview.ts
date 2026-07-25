import { fetchMsgMetadata } from '../api/nostr';
import { containsHttpsUrl } from '../utils/message-formatting';
import { dmError } from '../utils/dm-debug';
import type { DmMessage } from '../../stores/dm';

/** Message ids for which an OpenGraph preview fetch has already been requested this session. */
const requested = new Set<string>();

/**
 * Request an OpenGraph preview fetch for a message if it contains a URL and doesn't have
 * preview metadata yet. Safe to call for every message on both live delivery (message_new /
 * message_update) and historical load (chat open, load-older, pagination) - it's the latter
 * that backfills previews for messages whose fetch never completed before the app last quit.
 * Dedupes per message id for the lifetime of the app session.
 */
export function requestLinkPreview(chatId: string, message: DmMessage): void {
  if (message.pending || message.preview_metadata) return;
  if (!message.id || requested.has(message.id)) return;
  if (!containsHttpsUrl(message.content ?? '')) return;
  requested.add(message.id);
  fetchMsgMetadata(chatId, message.id).catch((e) => dmError('fetchMsgMetadata', e));
}

/** Reset pending-request tracking. Called from `clearAccountState()` on logout/account switch. */
export function clearLinkPreviewRequests(): void {
  requested.clear();
}
