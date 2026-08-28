import { get } from 'svelte/store';
import { fetchMsgMetadata } from '../api/nostr';
import { containsHttpsUrl } from '../utils/message-formatting';
import { dmError } from '../utils/dm-debug';
import { webPreviewsEnabled } from '../../stores/web-previews';
import type { DmMessage } from '../../stores/dm';

/** Message ids for which an OpenGraph preview fetch has already been requested this session. */
const requested = new Set<string>();

/** Cap concurrent `fetchMsgMetadata` calls so a fast scroll through many linked messages
 * doesn't fire a burst of simultaneous network requests. */
const MAX_CONCURRENT_FETCHES = 3;
let inFlight = 0;
const queue: Array<() => void> = [];

function runQueued(fn: () => Promise<unknown>): void {
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
 *
 * No-op when the user has disabled the "Web Previews" setting — skips queuing entirely so no
 * outbound request to the linked site is made. Returns `false` only in that case, so the caller
 * (the intersection observer) can keep watching the message and retry once the setting is
 * re-enabled; returns `true` for every other outcome (queued, or permanently ineligible) so the
 * caller can stop watching.
 */
export function requestLinkPreview(chatId: string, message: DmMessage): boolean {
  if (message.pending || message.preview_metadata) return true;
  if (!message.id || requested.has(message.id)) return true;
  if (!containsHttpsUrl(message.content ?? '')) return true;
  if (!get(webPreviewsEnabled)) return false;
  requested.add(message.id);
  runQueued(() => fetchMsgMetadata(chatId, message.id).catch((e) => dmError('fetchMsgMetadata', e)));
  return true;
}

/** Reset pending-request tracking. Called from `clearAccountState()` on logout/account switch. */
export function clearLinkPreviewRequests(): void {
  requested.clear();
}
