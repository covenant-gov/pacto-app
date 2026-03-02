import { writable } from 'svelte/store';
import type { Address } from 'viem';
import { getSafeState, type SafeState } from '$lib/wallet/safe';

export interface SafeStateEntry {
  safeAddress: string;
  state: SafeState | null;
  error: string | null;
  loading: boolean;
  lastFetchedAt: number | null;
}

/** Cache of last-fetched Safe state keyed by parent id (squad or network id). */
export const safeStateByParentId = writable<Record<string, SafeStateEntry>>({});

const inflightByParentId = new Map<string, Promise<void>>();
const STALE_AFTER_MS = 30_000;

/**
 * Refresh Safe state for a parent.
 * - Shows cached state immediately (if present)
 * - Triggers background refresh when stale / forced
 * - Dedupes concurrent fetches per parent id
 */
export async function refreshSafeStateForParent(
  parentId: string,
  safeAddress: string,
  opts?: { force?: boolean }
): Promise<void> {
  if (!parentId || !safeAddress) return;

  const key = parentId;
  const existing = inflightByParentId.get(key);
  if (existing) return existing;

  const now = Date.now();
  let shouldFetch = true;

  safeStateByParentId.update((map) => {
    const cur = map[key];
    const sameAddr = cur?.safeAddress === safeAddress;
    const freshEnough =
      !!cur?.lastFetchedAt && now - cur.lastFetchedAt < STALE_AFTER_MS;

    if (sameAddr && !opts?.force) {
      if (cur.loading || freshEnough) {
        shouldFetch = false;
        return map;
      }
      // Mark as loading but keep cached state for smooth UX.
      return { ...map, [key]: { ...cur, loading: true, error: null } };
    }

    // New parent entry or address changed: avoid showing mismatched state.
    const next: SafeStateEntry = {
      safeAddress,
      state: sameAddr ? cur?.state ?? null : null,
      error: null,
      loading: true,
      lastFetchedAt: cur?.lastFetchedAt ?? null,
    };
    return { ...map, [key]: next };
  });

  if (!shouldFetch) return;

  const p = (async () => {
    try {
      const state = await getSafeState(safeAddress as Address);
      safeStateByParentId.update((map) => {
        const cur = map[key];
        if (!cur || cur.safeAddress !== safeAddress) return map;
        return {
          ...map,
          [key]: {
            ...cur,
            state,
            error: null,
            loading: false,
            lastFetchedAt: Date.now(),
          },
        };
      });
    } catch (e) {
      const msg = (e as Error)?.message ?? 'Failed to read Safe';
      safeStateByParentId.update((map) => {
        const cur = map[key];
        if (!cur || cur.safeAddress !== safeAddress) return map;
        return {
          ...map,
          [key]: {
            ...cur,
            error: msg,
            loading: false,
            lastFetchedAt: Date.now(),
          },
        };
      });
    } finally {
      inflightByParentId.delete(key);
    }
  })();

  inflightByParentId.set(key, p);
  return p;
}

