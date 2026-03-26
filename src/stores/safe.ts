import { writable } from 'svelte/store';
import type { Address } from 'viem';
import type { TreasurySafeEntry } from '$lib/treasury/treasury-safes';
import { parseSupportedChainId, type SupportedChainId } from '$lib/wallet/chains';
import { getSafeState, type SafeState } from '$lib/wallet/safe';

export interface SafeStateEntry {
  treasuryEntryId: string;
  safeAddress: string;
  chainId: SupportedChainId;
  state: SafeState | null;
  error: string | null;
  loading: boolean;
  lastFetchedAt: number | null;
}

/** Cache of last-fetched Safe on-chain state keyed by treasury row id (`TreasurySafeEntry.id`). */
export const safeStateByTreasuryId = writable<Record<string, SafeStateEntry>>({});

const inflightByTreasuryId = new Map<string, Promise<void>>();
const STALE_AFTER_MS = 30_000;

/**
 * Refresh Safe read state for one treasury list row.
 * Dedupes concurrent fetches per `entry.id`.
 */
export async function refreshSafeStateForTreasuryEntry(
  entry: TreasurySafeEntry,
  opts?: { force?: boolean }
): Promise<void> {
  if (!entry?.id || !entry.safeAddress) return;

  const key = entry.id;
  const chainId = parseSupportedChainId(entry.chain);
  const existing = inflightByTreasuryId.get(key);
  if (existing) return existing;

  const now = Date.now();
  let shouldFetch = true;

  safeStateByTreasuryId.update((map) => {
    const cur = map[key];
    const same =
      cur?.safeAddress === entry.safeAddress && cur?.chainId === chainId;
    const freshEnough =
      !!cur?.lastFetchedAt && now - cur.lastFetchedAt < STALE_AFTER_MS;

    if (same && !opts?.force) {
      if (cur.loading || freshEnough) {
        shouldFetch = false;
        return map;
      }
      return { ...map, [key]: { ...cur, loading: true, error: null } };
    }

    const next: SafeStateEntry = {
      treasuryEntryId: key,
      safeAddress: entry.safeAddress,
      chainId,
      state: same ? cur?.state ?? null : null,
      error: null,
      loading: true,
      lastFetchedAt: cur?.lastFetchedAt ?? null,
    };
    return { ...map, [key]: next };
  });

  if (!shouldFetch) return;

  const p = (async () => {
    try {
      const state = await getSafeState(entry.safeAddress as Address, chainId);
      safeStateByTreasuryId.update((map) => {
        const cur = map[key];
        if (!cur || cur.safeAddress !== entry.safeAddress || cur.chainId !== chainId) {
          return map;
        }
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
      safeStateByTreasuryId.update((map) => {
        const cur = map[key];
        if (!cur || cur.safeAddress !== entry.safeAddress) return map;
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
      inflightByTreasuryId.delete(key);
    }
  })();

  inflightByTreasuryId.set(key, p);
  return p;
}
