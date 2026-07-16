/**
 * Short-lived session cache for Governance module on-chain reads
 * (Mutiny / Quartermaster / Treasury Safe). Survives panel remounts;
 * stale entries still hydrate UI while a background fetch runs.
 */

export const GOV_MODULE_READ_TTL_MS = 2 * 60 * 1000;

type CacheEntry = {
  parentId: string;
  value: unknown;
  fetchedAtMs: number;
};

const entries = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

export function mutinyReadCacheKey(
  network: string,
  mutinyModule: string,
  voterAddress = '',
): string {
  return `mutiny:${network.trim().toLowerCase()}:${mutinyModule.trim().toLowerCase()}:${voterAddress.trim().toLowerCase()}`;
}

export function quartermasterReadCacheKey(network: string, quartermaster: string): string {
  return `qm:v2:${network.trim().toLowerCase()}:${quartermaster.trim().toLowerCase()}`;
}

export function safeBalancesCacheKey(
  parentId: string,
  network: string,
  safeAddress: string,
): string {
  return `safe:${parentId.trim()}:${network.trim().toLowerCase()}:${safeAddress.trim().toLowerCase()}`;
}

/** Last value for key even if TTL expired (for stale-while-revalidate hydrate). */
export function peekGovModuleRead<T>(key: string): T | null {
  const e = entries.get(key);
  return e ? (e.value as T) : null;
}

export function isGovModuleReadStale(key: string): boolean {
  const e = entries.get(key);
  if (!e) return true;
  return Date.now() - e.fetchedAtMs > GOV_MODULE_READ_TTL_MS;
}

export function setGovModuleRead<T>(key: string, parentId: string, value: T): void {
  entries.set(key, {
    parentId: parentId.trim(),
    value,
    fetchedAtMs: Date.now(),
  });
}

export function clearGovModuleReadsForParent(parentId: string): void {
  const pid = parentId.trim();
  if (!pid) return;
  for (const [k, e] of entries) {
    if (e.parentId === pid) entries.delete(k);
  }
}

/** Test helper. */
export function clearAllGovModuleReads(): void {
  entries.clear();
  inflight.clear();
}

export async function fetchGovModuleReadCached<T>(
  key: string,
  parentId: string,
  fetcher: () => Promise<T>,
  options: { force?: boolean } = {},
): Promise<T> {
  if (!options.force) {
    const e = entries.get(key);
    if (e && Date.now() - e.fetchedAtMs <= GOV_MODULE_READ_TTL_MS) {
      return e.value as T;
    }
  }

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const promise = fetcher()
    .then((value) => {
      setGovModuleRead(key, parentId, value);
      inflight.delete(key);
      return value;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}
