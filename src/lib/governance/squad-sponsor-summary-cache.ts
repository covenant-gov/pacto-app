import type { SquadSponsorSummaryDto } from './api';

/** Session TTL for sponsor pool balance — manual refresh remains available sooner. */
export const SPONSOR_SUMMARY_TTL_MS = 30 * 60 * 1000;

type CacheEntry = {
  key: string;
  summary: SquadSponsorSummaryDto;
  fetchedAtMs: number;
};

let sessionEntry: CacheEntry | null = null;
const inflight = new Map<string, Promise<SquadSponsorSummaryDto>>();

export function sponsorSummaryCacheKey(
  parentId: string,
  sponsorAddress: string,
  network: string
): string {
  return `${parentId.trim()}:${sponsorAddress.trim().toLowerCase()}:${network.trim().toLowerCase()}`;
}

export function getCachedSponsorSummary(key: string): SquadSponsorSummaryDto | null {
  if (!sessionEntry || sessionEntry.key !== key) return null;
  if (Date.now() - sessionEntry.fetchedAtMs > SPONSOR_SUMMARY_TTL_MS) return null;
  return sessionEntry.summary;
}

export function setCachedSponsorSummary(key: string, summary: SquadSponsorSummaryDto): void {
  sessionEntry = { key, summary, fetchedAtMs: Date.now() };
}

export function isSponsorSummaryCacheStale(key: string): boolean {
  if (!sessionEntry || sessionEntry.key !== key) return true;
  return Date.now() - sessionEntry.fetchedAtMs > SPONSOR_SUMMARY_TTL_MS;
}

export async function fetchSponsorSummaryCached(
  key: string,
  fetcher: () => Promise<SquadSponsorSummaryDto>,
  options: { force?: boolean } = {}
): Promise<SquadSponsorSummaryDto> {
  if (!options.force) {
    const cached = getCachedSponsorSummary(key);
    if (cached) return cached;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = fetcher()
    .then((summary) => {
      setCachedSponsorSummary(key, summary);
      inflight.delete(key);
      return summary;
    })
    .catch((e) => {
      inflight.delete(key);
      throw e;
    });

  inflight.set(key, promise);
  return promise;
}
