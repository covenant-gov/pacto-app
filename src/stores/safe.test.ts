import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Address } from 'viem';
import {
  safeStateByTreasuryId,
  refreshSafeStateForTreasuryEntry,
} from './safe';
import { getSafeState, type SafeState } from '$lib/wallet/safe';
import { withReadPlaneLimit } from '$lib/evm/read-plane-limiter';
import { persistSafeStateCacheEntry } from '$lib/dashboard/safe-state-disk-cache';
import { setCurrentNpubForPersistence } from './persistence-context';

vi.mock('$lib/wallet/safe', () => ({
  getSafeState: vi.fn(),
}));

vi.mock('$lib/evm/read-plane-limiter', () => ({
  withReadPlaneLimit: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock('$lib/dashboard/safe-state-disk-cache', () => ({
  SAFE_STATE_DISK_CACHE_VERSION: 1,
  SAFE_STATE_DISK_CACHE_PREFIX: 'pacto_safe_state_cache_v1',
  SAFE_STATE_DISK_TTL_MS: 15 * 60 * 1000,
  persistSafeStateCacheEntry: vi.fn(),
}));

describe('safe', () => {
  const baseEntry = (id: string, overrides?: { safeAddress?: string; chain?: string }) => ({
    id,
    parentId: 'parent-1',
    safeAddress: overrides?.safeAddress ?? '0x0000000000000000000000000000000000000001',
    chain: overrides?.chain ?? 'sepolia',
    label: 'Test Safe',
    createdAtMs: 1,
  });

  const baseState: SafeState = {
    address: '0x0000000000000000000000000000000000000001' as Address,
    owners: ['0x0000000000000000000000000000000000000002' as Address],
    threshold: 1,
    nonce: 0n,
    balanceWei: 0n,
    balanceFormatted: '0',
  };

  beforeEach(() => {
    vi.mocked(getSafeState).mockReset();
    vi.mocked(withReadPlaneLimit).mockReset();
    vi.mocked(withReadPlaneLimit).mockImplementation((fn: () => Promise<unknown>) => fn());
    vi.mocked(persistSafeStateCacheEntry).mockReset();
  });

  afterEach(() => {
    safeStateByTreasuryId.set({});
    setCurrentNpubForPersistence(null);
    vi.clearAllMocks();
  });

  it('starts with an empty cache', () => {
    expect(get(safeStateByTreasuryId)).toEqual({});
  });

  it('does nothing when entry id or safe address is missing', async () => {
    await refreshSafeStateForTreasuryEntry(baseEntry('', { safeAddress: '' }));
    expect(getSafeState).not.toHaveBeenCalled();
  });

  it('fetches and stores safe state', async () => {
    vi.mocked(getSafeState).mockResolvedValue(baseState);
    setCurrentNpubForPersistence('npub1abc');

    await refreshSafeStateForTreasuryEntry(baseEntry('t1'));

    const state = get(safeStateByTreasuryId);
    expect(state['t1']).toMatchObject({
      treasuryEntryId: 't1',
      safeAddress: '0x0000000000000000000000000000000000000001',
      chainId: 'sepolia',
      state: baseState,
      error: null,
      loading: false,
    });
    expect(state['t1']?.lastFetchedAt).toBeGreaterThan(0);
    expect(persistSafeStateCacheEntry).toHaveBeenCalledOnce();
  });

  it('skips a fresh fetch without force', async () => {
    vi.mocked(getSafeState).mockResolvedValue(baseState);
    await refreshSafeStateForTreasuryEntry(baseEntry('t2'));
    vi.mocked(getSafeState).mockClear();

    await refreshSafeStateForTreasuryEntry(baseEntry('t2'));
    expect(getSafeState).not.toHaveBeenCalled();
    expect(get(safeStateByTreasuryId)['t2']?.loading).toBe(false);
  });

  it('forces a fresh fetch', async () => {
    vi.mocked(getSafeState).mockResolvedValue(baseState);
    await refreshSafeStateForTreasuryEntry(baseEntry('t3'));
    vi.mocked(getSafeState).mockClear();

    await refreshSafeStateForTreasuryEntry(baseEntry('t3'), { force: true });
    expect(getSafeState).toHaveBeenCalledOnce();
  });

  it('records an error when the fetch fails', async () => {
    vi.mocked(getSafeState).mockRejectedValue(new Error('RPC down'));
    await refreshSafeStateForTreasuryEntry(baseEntry('t4'));

    const state = get(safeStateByTreasuryId)['t4'];
    expect(state?.error).toBe('RPC down');
    expect(state?.loading).toBe(false);
  });

  it('does not persist when no npub is set', async () => {
    vi.mocked(getSafeState).mockResolvedValue(baseState);
    await refreshSafeStateForTreasuryEntry(baseEntry('t5'));
    expect(persistSafeStateCacheEntry).not.toHaveBeenCalled();
  });

  it('does not update a stale entry when safe address or chain changes', async () => {
    vi.mocked(getSafeState).mockResolvedValue(baseState);
    await refreshSafeStateForTreasuryEntry(baseEntry('t6'));
    vi.mocked(getSafeState).mockRejectedValue(new Error('should not fetch'));

    await refreshSafeStateForTreasuryEntry({ ...baseEntry('t6'), safeAddress: '0x0000000000000000000000000000000000000003' });
    const state = get(safeStateByTreasuryId)['t6'];
    expect(state?.safeAddress).toBe('0x0000000000000000000000000000000000000003');
    expect(state?.state).toBeNull();
  });
});
