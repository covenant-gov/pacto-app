import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SAFE_STATE_DISK_CACHE_PREFIX,
  SAFE_STATE_DISK_TTL_MS,
  hydrateSafeStateCacheFromDisk,
  persistSafeStateCacheEntry,
} from './safe-state-disk-cache';
import type { SafeStateEntry } from '../../stores/safe';
import type { SupportedChainId } from '../wallet/chains';

describe('safe-state-disk-cache', () => {
  const npub = 'npub1testsafestate';

  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  function sampleEntry(opts: { treasuryEntryId?: string; lastFetchedAt?: number } = {}): SafeStateEntry {
    return {
      treasuryEntryId: opts.treasuryEntryId ?? 'entry-1',
      safeAddress: '0xabc',
      chainId: 'sepolia' as SupportedChainId,
      state: {
        address: '0xabc',
        owners: ['0xdef'],
        threshold: 1,
        nonce: 0n,
        balanceWei: 1000n,
        balanceFormatted: '0.000000000000001',
      },
      error: null,
      loading: false,
      lastFetchedAt: opts.lastFetchedAt ?? Date.now(),
    };
  }

  it('round-trips SafeState entries through wire format', () => {
    const entry = sampleEntry();
    persistSafeStateCacheEntry(npub, entry);
    expect(localStorage.getItem(`${SAFE_STATE_DISK_CACHE_PREFIX}_${npub}`)).toBeTruthy();

    const merged: Record<string, SafeStateEntry> = {};
    hydrateSafeStateCacheFromDisk(npub, (rows) => Object.assign(merged, rows));

    const hydrated = merged['entry-1'];
    expect(hydrated).toBeDefined();
    expect(hydrated.treasuryEntryId).toBe('entry-1');
    expect(hydrated.safeAddress).toBe('0xabc');
    expect(hydrated.chainId).toBe('sepolia');
    expect(hydrated.error).toBeNull();
    expect(hydrated.loading).toBe(false);

    const state = hydrated.state;
    expect(state).not.toBeNull();
    expect(state?.address).toBe('0xabc');
    expect(state?.owners).toEqual(['0xdef']);
    expect(state?.threshold).toBe(1);
    expect(state?.nonce).toBe(0n);
    expect(state?.balanceWei).toBe(1000n);
    expect(state?.balanceFormatted).toBe('0.000000000000001');
  });

  it('evicts stale entries by TTL', () => {
    const stale = sampleEntry({ lastFetchedAt: Date.now() - SAFE_STATE_DISK_TTL_MS - 1000 });
    persistSafeStateCacheEntry(npub, stale);

    const merged: Record<string, SafeStateEntry> = {};
    hydrateSafeStateCacheFromDisk(npub, (rows) => Object.assign(merged, rows));

    expect(merged['entry-1']).toBeUndefined();
  });

  it('merges hydrated rows into existing state via the merge callback', () => {
    const entry1 = sampleEntry({ treasuryEntryId: 'entry-1', lastFetchedAt: Date.now() });
    const entry2 = sampleEntry({ treasuryEntryId: 'entry-2', lastFetchedAt: Date.now() });
    persistSafeStateCacheEntry(npub, entry1);
    persistSafeStateCacheEntry(npub, entry2);

    const merged: Record<string, SafeStateEntry> = {};
    hydrateSafeStateCacheFromDisk(npub, (rows) => Object.assign(merged, rows));

    expect(Object.keys(merged)).toHaveLength(2);
    expect(merged['entry-1']).toBeDefined();
    expect(merged['entry-2']).toBeDefined();
  });

  it('ignores malformed persisted blobs', () => {
    store.set(`${SAFE_STATE_DISK_CACHE_PREFIX}_${npub}`, JSON.stringify({ version: 2, byTreasuryEntryId: {} }));
    const merged: Record<string, SafeStateEntry> = {};
    hydrateSafeStateCacheFromDisk(npub, (rows) => Object.assign(merged, rows));
    expect(Object.keys(merged)).toHaveLength(0);
  });
});
