import { fetchMsgMetadata } from '../api/nostr';
import { containsHttpsUrl } from '../utils/message-formatting';
import { dmError } from '../utils/dm-debug';
import type { DmMessage } from '../../stores/dm';

/** Message ids for which an OpenGraph preview fetch has already been requested this session. */
const requested = new Set<string>();

/** Cap concurrent `fetchMsgMetadata` calls so a fast scroll through many linked messages
 * doesn't fire a burst of simultaneous network requests. */
const MAX_CONCURRENT_FETCHES = 3;
let inFlight = 0;
const queue: Array<() => void> = [];

function runQueued(fn: () => Promise<void>): void {
  const start = () => {
    inFlight++;
    fn().finally(() => {
      inFlight--;
      const next = queue.shift();
      if (next) next();
    });
  };
  if (inFlight < MAX_CONCURRENT_FETCHES) start();
  else queue.push(start);
}

/**
 * Request an OpenGraph preview fetch for a message if it contains a URL and doesn't have
 * preview metadata yet. Called lazily as each message scrolls into view (see
 * `link-preview-observer.ts`), not eagerly on arrival/load, so read-behavior for a link isn't
 * leaked before the user has actually seen the message. Dedupes per message id for the
 * lifetime of the app session; the actual fetch is concurrency-capped via `runQueued`.
 */
export function requestLinkPreview(chatId: string, message: DmMessage): void {
  if (message.pending || message.preview_metadata) return;
  if (!message.id || requested.has(message.id)) return;
  if (!containsHttpsUrl(message.content ?? '')) return;
  requested.add(message.id);
  runQueued(() => fetchMsgMetadata(chatId, message.id).catch((e) => dmError('fetchMsgMetadata', e)));
}

/** Reset pending-request tracking. Called from `clearAccountState()` on logout/account switch. */
export function clearLinkPreviewRequests(): void {
  requested.clear();
}
