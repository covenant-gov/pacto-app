import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearWalletSummaryCacheStore,
  getMatchingCachedSummary,
  persistWalletSummaryCache,
} from './wallet-summary-cache';
import type { WalletSummary } from './backend-wallet';
import type { WatchedErc20Wire } from './watched-tokens';

const summary = {
  networks: [],
  totalUsdApprox: 1,
  usdPricingStatus: 'complete',
} as WalletSummary;

const wires: WatchedErc20Wire[] = [
  { network: 'sepolia', symbol: 'USDC', address: '0xabc', decimals: 6 },
];

describe('wallet summary cache address', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    clearWalletSummaryCacheStore();
  });

  it('matches a snapshot only for the address it was fetched for', () => {
    persistWalletSummaryCache('npub1', wires, summary, '0xAAA');
    expect(getMatchingCachedSummary('npub1', wires, '0xaaa')).toEqual(summary);
    expect(getMatchingCachedSummary('npub1', wires, '0xbbb')).toBeNull();
  });
});
