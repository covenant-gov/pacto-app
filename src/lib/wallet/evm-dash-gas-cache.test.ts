import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EVM_DASH_GAS_TTL_MS,
  clearEvmDashGasCache,
  evmDashGasCacheKey,
  fetchEvmDashGasCached,
  getCachedEvmDashGas,
  isEvmDashGasCacheStale,
  setCachedEvmDashGas,
  type EvmDashGasSnapshot,
} from './evm-dash-gas-cache';

const snapshot: EvmDashGasSnapshot = {
  rows: [],
  poolWei: '1000000000000000000',
  poolError: '',
};

afterEach(() => {
  clearEvmDashGasCache();
  vi.useRealTimers();
});

describe('evm-dash-gas-cache', () => {
  it('builds a stable lowercase key', () => {
    expect(evmDashGasCacheKey('SEPOLIA')).toBe('sepolia');
    expect(evmDashGasCacheKey(' sepolia ')).toBe('sepolia');
  });

  it('returns cached snapshot within TTL', () => {
    const key = evmDashGasCacheKey('sepolia');
    setCachedEvmDashGas(key, snapshot);
    expect(getCachedEvmDashGas(key)).toEqual(snapshot);
    expect(isEvmDashGasCacheStale(key)).toBe(false);
  });

  it('dedupes in-flight fetches', async () => {
    const key = evmDashGasCacheKey('sepolia');
    const fetcher = vi.fn(async () => snapshot);

    const first = fetchEvmDashGasCached(key, fetcher, { force: true });
    const second = fetchEvmDashGasCached(key, fetcher, { force: true });
    await Promise.all([first, second]);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('skips the fetcher on a cache hit unless force is set', async () => {
    const key = evmDashGasCacheKey('sepolia');
    setCachedEvmDashGas(key, snapshot);
    const fetcher = vi.fn(async () => snapshot);

    await fetchEvmDashGasCached(key, fetcher);
    expect(fetcher).not.toHaveBeenCalled();

    await fetchEvmDashGasCached(key, fetcher, { force: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('expires after TTL', () => {
    vi.useFakeTimers();
    const key = evmDashGasCacheKey('sepolia');
    setCachedEvmDashGas(key, snapshot);
    vi.advanceTimersByTime(EVM_DASH_GAS_TTL_MS + 1);
    expect(getCachedEvmDashGas(key)).toBeNull();
    expect(isEvmDashGasCacheStale(key)).toBe(true);
  });
});
