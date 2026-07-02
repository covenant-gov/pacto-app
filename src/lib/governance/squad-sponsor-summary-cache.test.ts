import { describe, expect, it, vi } from 'vitest';
import {
  SPONSOR_SUMMARY_TTL_MS,
  fetchSponsorSummaryCached,
  getCachedSponsorSummary,
  isSponsorSummaryCacheStale,
  setCachedSponsorSummary,
  sponsorSummaryCacheKey,
} from './squad-sponsor-summary-cache';
import type { SquadSponsorSummaryDto } from './api';

const summary: SquadSponsorSummaryDto = {
  chain: 'sepolia',
  parentId: 'parent-1',
  sponsorAddress: '0xabc',
  poolBalanceWei: '10000000000000000',
};

describe('squad-sponsor-summary-cache', () => {
  it('builds stable cache keys', () => {
    expect(sponsorSummaryCacheKey('p1', '0xAbC', 'sepolia')).toBe('p1:0xabc:sepolia');
  });

  it('returns cached summary within TTL', () => {
    const key = sponsorSummaryCacheKey('p1', '0xabc', 'sepolia');
    setCachedSponsorSummary(key, summary);
    expect(getCachedSponsorSummary(key)).toEqual(summary);
    expect(isSponsorSummaryCacheStale(key)).toBe(false);
  });

  it('dedupes in-flight fetches', async () => {
    vi.useFakeTimers();
    const key = sponsorSummaryCacheKey('p2', '0xdef', 'sepolia');
    const fetcher = vi.fn(async () => summary);

    const first = fetchSponsorSummaryCached(key, fetcher, { force: true });
    const second = fetchSponsorSummaryCached(key, fetcher, { force: true });
    await Promise.all([first, second]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('expires after TTL', () => {
    vi.useFakeTimers();
    const key = sponsorSummaryCacheKey('p3', '0x111', 'sepolia');
    setCachedSponsorSummary(key, summary);
    vi.advanceTimersByTime(SPONSOR_SUMMARY_TTL_MS + 1);
    expect(getCachedSponsorSummary(key)).toBeNull();
    expect(isSponsorSummaryCacheStale(key)).toBe(true);
    vi.useRealTimers();
  });
});
