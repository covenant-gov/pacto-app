/**
 * Warm Commons after unlock: cached broadcasts (DB-only).
 * Tag art preloads on first Commons browse open — not on cold login.
 */

import { get, writable } from 'svelte/store';
import { fetchCommonsBroadcasts, fetchCommonsBroadcastsCached } from '../api/commons';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import { COMMONS_TAG_TREE, commonsTagArtSrc } from './tag-catalog';
import type { CommonsBroadcastDto } from './types';
import { t } from 'svelte-i18n';

export const commonsBroadcasts = writable<CommonsBroadcastDto[]>([]);
export const commonsFeedSyncing = writable(false);
export const commonsFeedError = writable<string | null>(null);

const LIVE_CHANGE_DEBOUNCE_MS = 250;

let prefetchStarted = false;
let tagArtPreloadStarted = false;
let liveChangeDebounceTimer: ReturnType<typeof setTimeout> | undefined;
let lastLiveChangeAt = 0;

export function resetCommonsPrefetchSession(): void {
  prefetchStarted = false;
  tagArtPreloadStarted = false;
  commonsBroadcasts.set([]);
  commonsFeedError.set(null);
  commonsFeedSyncing.set(false);
  clearTimeout(liveChangeDebounceTimer);
  liveChangeDebounceTimer = undefined;
  lastLiveChangeAt = 0;
}

/** Warm category tile images on first Commons open. */
export function preloadCommonsTagArt(): void {
  if (tagArtPreloadStarted) return;
  tagArtPreloadStarted = true;
  for (const category of COMMONS_TAG_TREE) {
    const src = commonsTagArtSrc(category);
    if (!src) continue;
    const img = new Image();
    img.src = src;
  }
}

async function prefetchCachedBroadcasts(): Promise<void> {
  try {
    const rows = await fetchCommonsBroadcastsCached(100);
    if (rows.length > 0) {
      commonsBroadcasts.set(rows);
    }
  } catch {
    // No account selected yet, or DB unavailable — safe to ignore.
  }
}

/** Idempotent: last-session broadcast cache after unlock. */
export function scheduleCommonsStartupPrefetch(): void {
  if (prefetchStarted) return;
  prefetchStarted = true;
  void prefetchCachedBroadcasts();
}

export async function refreshCommonsBroadcasts(
  options: { silent?: boolean } = {}
): Promise<CommonsBroadcastDto[]> {
  const silent = options.silent ?? false;
  if (!silent) commonsFeedSyncing.set(true);
  commonsFeedError.set(null);
  try {
    const rows = await fetchCommonsBroadcasts(100);
    commonsBroadcasts.set(rows);
    return rows;
  } catch (e: unknown) {
    const message = getInvokeErrorMessage(e, get(t)('commons.errors.loadFeedFailed'));
    commonsFeedError.set(message);
    if (!silent) {
      commonsBroadcasts.set([]);
    }
    return get(commonsBroadcasts);
  } finally {
    if (!silent) commonsFeedSyncing.set(false);
  }
}

async function applyLiveCommonsChangeNow(): Promise<void> {
  try {
    // Re-read the DB cache rather than splicing client-side: the backend already
    // applies dedupe/replacement/cancellation ordering in list_active_broadcasts.
    const rows = await fetchCommonsBroadcastsCached(100);
    commonsBroadcasts.set(rows);
    lastLiveChangeAt = Date.now();
  } catch {
    // Leave the store untouched on failure.
  }
}

/** Debounced live-reload after a backend `commons_broadcasts_changed` event. */
export function applyLiveCommonsChange(): void {
  clearTimeout(liveChangeDebounceTimer);
  liveChangeDebounceTimer = setTimeout(() => {
    liveChangeDebounceTimer = undefined;
    void applyLiveCommonsChangeNow();
  }, LIVE_CHANGE_DEBOUNCE_MS);
}

/** Ms epoch of the last applied live change, or 0 if none this session. */
export function getLastCommonsLiveChangeAt(): number {
  return lastLiveChangeAt;
}
