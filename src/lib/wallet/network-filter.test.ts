import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import type { SupportedChainId } from './chains';
import {
  PROFILE_NETWORK_FILTER_PREFIX,
  coerceNetworkFilter,
  loadNetworkFilter,
  parseNetworkFilter,
  saveNetworkFilter,
} from './network-filter';

describe('network-filter', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    setCurrentNpubForPersistence('npub1test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setCurrentNpubForPersistence(null);
  });

  it('parses unknown values to all', () => {
    expect(parseNetworkFilter(null)).toBe('all');
    expect(parseNetworkFilter('not-a-chain')).toBe('all');
    expect(parseNetworkFilter('all')).toBe('all');
  });

  it('round-trips a chain under an npub-scoped key', () => {
    saveNetworkFilter(PROFILE_NETWORK_FILTER_PREFIX, 'mainnet' as SupportedChainId);
    expect(store.has(`${PROFILE_NETWORK_FILTER_PREFIX}_npub1test`)).toBe(true);
    expect(loadNetworkFilter(PROFILE_NETWORK_FILTER_PREFIX)).toBe('mainnet');
  });

  it('does not persist without an account', () => {
    setCurrentNpubForPersistence(null);
    saveNetworkFilter(PROFILE_NETWORK_FILTER_PREFIX, 'mainnet' as SupportedChainId);
    expect(store.size).toBe(0);
    expect(loadNetworkFilter(PROFILE_NETWORK_FILTER_PREFIX)).toBe('all');
  });

  it('falls back to all when the chain is disabled', () => {
    const enabled = new Set<SupportedChainId>(['sepolia'] as SupportedChainId[]);
    expect(coerceNetworkFilter('mainnet' as SupportedChainId, enabled)).toBe('all');
    expect(coerceNetworkFilter('sepolia' as SupportedChainId, enabled)).toBe('sepolia');
    expect(coerceNetworkFilter('all', enabled)).toBe('all');
  });
});
