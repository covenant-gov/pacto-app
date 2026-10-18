/**
 * Warm Commons after unlock: cached broadcasts (DB-only).
 * Tag art preloads on first Commons browse open — not on cold login.
 */

import { get, writable } from 'svelte/store';
import { fetchCommonsBroadcasts, fetchCommonsBroadcastsCached } from '../api/commons';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import { COMMONS_TAG_TREE, commonsTagArtSrc } from './tag-catalog';
import type { CommonsBroadcastDto } from './types';

export const commonsBroadcasts = writable<CommonsBroadcastDto[]>([]);
export const commonsFeedSyncing = writable(false);
export const commonsFeedError = writable<string | null>(null);

let prefetchStarted = false;
let tagArtPreloadStarted = false;

export function resetCommonsPrefetchSession(): void {
  prefetchStarted = false;
  tagArtPreloadStarted = false;
  commonsBroadcasts.set([]);
  commonsFeedError.set(null);
  commonsFeedSyncing.set(false);
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
    const message = getInvokeErrorMessage(e, 'Could not load Commons broadcasts.');
    commonsFeedError.set(message);
    if (!silent) {
      commonsBroadcasts.set([]);
    }
    return get(commonsBroadcasts);
  } finally {
    if (!silent) commonsFeedSyncing.set(false);
  }
}
