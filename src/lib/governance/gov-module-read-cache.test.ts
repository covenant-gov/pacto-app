import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GOV_MODULE_READ_TTL_MS,
  clearAllGovModuleReads,
  clearGovModuleReadsForParent,
  fetchGovModuleReadCached,
  isGovModuleReadStale,
  mutinyReadCacheKey,
  peekGovModuleRead,
  quartermasterReadCacheKey,
  safeBalancesCacheKey,
  setGovModuleRead,
} from './gov-module-read-cache';

afterEach(() => {
  clearAllGovModuleReads();
  vi.useRealTimers();
});

describe('gov-module-read-cache', () => {
  it('builds stable keys', () => {
    expect(mutinyReadCacheKey('SEPOLIA', '0xAbC', '0xDeF')).toBe('mutiny:sepolia:0xabc:0xdef');
    expect(quartermasterReadCacheKey('sepolia', '0xQm')).toBe('qm:sepolia:0xqm');
    expect(safeBalancesCacheKey('p1', 'SEPOLIA', '0xSafe')).toBe('safe:p1:sepolia:0xsafe');
  });

  it('peeks past TTL for hydrate but reports stale', () => {
    vi.useFakeTimers();
    const key = mutinyReadCacheKey('sepolia', '0x1', '');
    setGovModuleRead(key, 'parent-1', { status: { activeMutinyId: '0' }, hasVoted: false });
    expect(peekGovModuleRead(key)).not.toBeNull();
    expect(isGovModuleReadStale(key)).toBe(false);

    vi.advanceTimersByTime(GOV_MODULE_READ_TTL_MS + 1);
    expect(peekGovModuleRead(key)).not.toBeNull();
    expect(isGovModuleReadStale(key)).toBe(true);
  });

  it('returns fresh cache without calling fetcher', async () => {
    const key = quartermasterReadCacheKey('sepolia', '0xqm');
    setGovModuleRead(key, 'parent-1', { mutinyActive: false, crewChangeDelaySecs: '1' });
    const fetcher = vi.fn(async () => ({ mutinyActive: true, crewChangeDelaySecs: '99' }));
    const out = await fetchGovModuleReadCached(key, 'parent-1', fetcher);
    expect(out).toEqual({ mutinyActive: false, crewChangeDelaySecs: '1' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('dedupes in-flight forced fetches', async () => {
    const key = safeBalancesCacheKey('p1', 'sepolia', '0xsafe');
    const fetcher = vi.fn(async () => ({ nativeDecimal: '1' }));
    const a = fetchGovModuleReadCached(key, 'p1', fetcher, { force: true });
    const b = fetchGovModuleReadCached(key, 'p1', fetcher, { force: true });
    await Promise.all([a, b]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('clears entries for one parent', () => {
    setGovModuleRead(mutinyReadCacheKey('sepolia', '0x1'), 'parent-a', { a: 1 });
    setGovModuleRead(mutinyReadCacheKey('sepolia', '0x2'), 'parent-b', { b: 2 });
    clearGovModuleReadsForParent('parent-a');
    expect(peekGovModuleRead(mutinyReadCacheKey('sepolia', '0x1'))).toBeNull();
    expect(peekGovModuleRead(mutinyReadCacheKey('sepolia', '0x2'))).toEqual({ b: 2 });
  });

  it('rejects fetcher and clears inflight so a retry can run', async () => {
    const key = mutinyReadCacheKey('sepolia', '0xfail', '');
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockResolvedValueOnce({ ok: true });
    await expect(fetchGovModuleReadCached(key, 'p1', fetcher, { force: true })).rejects.toThrow(
      'rpc down',
    );
    expect(peekGovModuleRead(key)).toBeNull();
    await expect(fetchGovModuleReadCached(key, 'p1', fetcher, { force: true })).resolves.toEqual({
      ok: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('force refetch while stale replaces peeked value', async () => {
    vi.useFakeTimers();
    const key = quartermasterReadCacheKey('sepolia', '0xqm');
    setGovModuleRead(key, 'parent-1', { mutinyActive: false, crewChangeDelaySecs: '1' });
    vi.advanceTimersByTime(GOV_MODULE_READ_TTL_MS + 1);
    expect(isGovModuleReadStale(key)).toBe(true);
    expect(peekGovModuleRead(key)).toEqual({ mutinyActive: false, crewChangeDelaySecs: '1' });

    const fetcher = vi.fn(async () => ({ mutinyActive: true, crewChangeDelaySecs: '42' }));
    const out = await fetchGovModuleReadCached(key, 'parent-1', fetcher, { force: true });
    expect(out).toEqual({ mutinyActive: true, crewChangeDelaySecs: '42' });
    expect(peekGovModuleRead(key)).toEqual(out);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('concurrent force while pending still dedupes', async () => {
    const key = safeBalancesCacheKey('p1', 'sepolia', '0xsafe2');
    let release!: (v: { nativeDecimal: string }) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<{ nativeDecimal: string }>((resolve) => {
          release = resolve;
        }),
    );
    const a = fetchGovModuleReadCached(key, 'p1', fetcher, { force: true });
    const b = fetchGovModuleReadCached(key, 'p1', fetcher, { force: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    release({ nativeDecimal: '9' });
    await expect(Promise.all([a, b])).resolves.toEqual([
      { nativeDecimal: '9' },
      { nativeDecimal: '9' },
    ]);
  });
});
