/**
 * Warm Commons browse UI before PIN unlock: tag art + cached broadcasts (DB-only).
 * Full relay sync still runs after unlock when Commons is opened.
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

export function resetCommonsPrefetchSession(): void {
  prefetchStarted = false;
  commonsBroadcasts.set([]);
  commonsFeedError.set(null);
  commonsFeedSyncing.set(false);
}

function preloadCommonsTagArt(): void {
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

/** Idempotent: tag tiles + last-session broadcast cache, safe before PIN unlock. */
export function scheduleCommonsStartupPrefetch(): void {
  if (prefetchStarted) return;
  prefetchStarted = true;
  preloadCommonsTagArt();
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
