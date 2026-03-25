/**
 * Last successful `get_wallet_summary` snapshot per account: persisted to localStorage,
 * rehydrated on login via `hydrateWalletSummaryCacheFromDisk` + `loadAccountState`.
 */

import { get, writable } from 'svelte/store';
import type { WalletSummary } from './backend-wallet';
import type { WatchedErc20Wire } from './watched-tokens';

export const WALLET_SUMMARY_CACHE_VERSION = 1 as const;

const STORAGE_PREFIX = 'pacto_wallet_summary_cache_v1';

/** Stable fingerprint for the watched ERC-20 list passed to `get_wallet_summary`. */
export function watchedWireFingerprint(wires: WatchedErc20Wire[]): string {
  const sorted = [...wires].sort((a, b) => {
    const n = a.network.localeCompare(b.network);
    if (n !== 0) return n;
    return a.address.toLowerCase().localeCompare(b.address.toLowerCase());
  });
  return JSON.stringify(sorted);
}

export interface WalletSummaryHydrated {
  npub: string;
  watchedFingerprint: string;
  fetchedAtMs: number;
  summary: WalletSummary;
}

/** In-memory snapshot after disk read (login) or after a successful fetch. */
export const walletSummaryHydrated = writable<WalletSummaryHydrated | null>(null);

export function hydrateWalletSummaryCacheFromDisk(npub: string): void {
  if (typeof localStorage === 'undefined') return;
  const raw = localStorage.getItem(`${STORAGE_PREFIX}_${npub}`);
  if (!raw) {
    walletSummaryHydrated.set(null);
    return;
  }
  try {
    const o = JSON.parse(raw) as {
      version?: number;
      watchedFingerprint?: string;
      fetchedAtMs?: number;
      summary?: WalletSummary;
    };
    if (
      o.version !== WALLET_SUMMARY_CACHE_VERSION ||
      typeof o.watchedFingerprint !== 'string' ||
      !o.summary ||
      typeof o.summary !== 'object'
    ) {
      walletSummaryHydrated.set(null);
      return;
    }
    walletSummaryHydrated.set({
      npub,
      watchedFingerprint: o.watchedFingerprint,
      fetchedAtMs: typeof o.fetchedAtMs === 'number' ? o.fetchedAtMs : 0,
      summary: o.summary,
    });
  } catch {
    walletSummaryHydrated.set(null);
  }
}

export function persistWalletSummaryCache(
  npub: string,
  wires: WatchedErc20Wire[],
  summary: WalletSummary
): void {
  if (typeof localStorage === 'undefined' || !npub) return;
  const watchedFingerprint = watchedWireFingerprint(wires);
  const fetchedAtMs = Date.now();
  const payload = {
    version: WALLET_SUMMARY_CACHE_VERSION,
    watchedFingerprint,
    fetchedAtMs,
    summary,
  };
  try {
    localStorage.setItem(`${STORAGE_PREFIX}_${npub}`, JSON.stringify(payload));
  } catch {
    // ignore quota
  }
  walletSummaryHydrated.set({
    npub,
    watchedFingerprint,
    fetchedAtMs,
    summary,
  });
}

export function clearWalletSummaryCacheStore(): void {
  walletSummaryHydrated.set(null);
}

/** Returns cached summary only if it matches this account and watched-token set. */
export function getMatchingCachedSummary(
  npub: string | null | undefined,
  wires: WatchedErc20Wire[]
): WalletSummary | null {
  if (!npub) return null;
  const h = get(walletSummaryHydrated);
  if (!h || h.npub !== npub) return null;
  if (h.watchedFingerprint !== watchedWireFingerprint(wires)) return null;
  return h.summary;
}
