import type { GlobalSponsoredFeeUsageDto } from '../api/global-sponsor';

/** Session TTL for global pool + fee usage — manual refresh remains available sooner. */
export const EVM_DASH_GAS_TTL_MS = 30 * 60 * 1000;

export type EvmDashGasSnapshot = {
  rows: GlobalSponsoredFeeUsageDto[];
  poolWei: string | null;
  poolError: string;
};

type CacheEntry = {
  key: string;
  snapshot: EvmDashGasSnapshot;
  fetchedAtMs: number;
};

let sessionEntry: CacheEntry | null = null;
const inflight = new Map<string, Promise<EvmDashGasSnapshot>>();

export function evmDashGasCacheKey(network: string): string {
  return network.trim().toLowerCase();
}

export function getCachedEvmDashGas(key: string): EvmDashGasSnapshot | null {
  if (!sessionEntry || sessionEntry.key !== key) return null;
  if (Date.now() - sessionEntry.fetchedAtMs > EVM_DASH_GAS_TTL_MS) return null;
  return sessionEntry.snapshot;
}

export function setCachedEvmDashGas(key: string, snapshot: EvmDashGasSnapshot): void {
  sessionEntry = { key, snapshot, fetchedAtMs: Date.now() };
}

export function isEvmDashGasCacheStale(key: string): boolean {
  if (!sessionEntry || sessionEntry.key !== key) return true;
  return Date.now() - sessionEntry.fetchedAtMs > EVM_DASH_GAS_TTL_MS;
}

/** Test helper. */
export function clearEvmDashGasCache(): void {
  sessionEntry = null;
  inflight.clear();
}

export async function fetchEvmDashGasCached(
  key: string,
  fetcher: () => Promise<EvmDashGasSnapshot>,
  options: { force?: boolean } = {},
): Promise<EvmDashGasSnapshot> {
  if (!options.force) {
    const cached = getCachedEvmDashGas(key);
    if (cached) return cached;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = fetcher()
    .then((snapshot) => {
      setCachedEvmDashGas(key, snapshot);
      inflight.delete(key);
      return snapshot;
    })
    .catch((e) => {
      inflight.delete(key);
      throw e;
    });

  inflight.set(key, promise);
  return promise;
}
