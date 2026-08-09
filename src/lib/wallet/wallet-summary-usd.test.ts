import { describe, expect, it } from 'vitest';
import type { WalletSummaryNetwork } from './backend-wallet';
import { pricingStatusForNetworks, sumPricedUsd } from './wallet-summary-usd';

function net(
  assets: { symbol: string; usdValue: number | null }[],
  error?: string
): WalletSummaryNetwork {
  return {
    network: 'sepolia',
    chainId: 11155111,
    error,
    assets: assets.map((a) => ({
      symbol: a.symbol,
      balanceRaw: '0',
      balanceDecimal: '0',
      usdValue: a.usdValue,
    })),
  };
}

describe('wallet-summary-usd', () => {
  describe('sumPricedUsd', () => {
    it('returns null when every usdValue is null', () => {
      expect(sumPricedUsd([net([{ symbol: 'ETH', usdValue: null }])])).toBeNull();
    });

    it('sums only non-null usdValue lines', () => {
      expect(
        sumPricedUsd([
          net([
            { symbol: 'ETH', usdValue: 10 },
            { symbol: 'USDC', usdValue: null },
          ]),
          net([{ symbol: 'ETH', usdValue: 2.5 }]),
        ])
      ).toBe(12.5);
    });

    it('skips networks with RPC errors', () => {
      expect(
        sumPricedUsd([
          net([{ symbol: 'ETH', usdValue: 5 }], 'down'),
          net([{ symbol: 'ETH', usdValue: 1 }]),
        ])
      ).toBe(1);
    });
  });

  describe('pricingStatusForNetworks', () => {
    it('is unavailable when no priced lines succeed', () => {
      expect(pricingStatusForNetworks([net([{ symbol: 'ETH', usdValue: null }])])).toBe(
        'unavailable'
      );
    });

    it('is complete when every priced asset has usdValue', () => {
      expect(
        pricingStatusForNetworks([
          net([
            { symbol: 'ETH', usdValue: 1 },
            { symbol: 'USDC', usdValue: 2 },
          ]),
        ])
      ).toBe('complete');
    });

    it('is partial when some priced assets lack usdValue', () => {
      expect(
        pricingStatusForNetworks([
          net([
            { symbol: 'ETH', usdValue: 1 },
            { symbol: 'USDC', usdValue: null },
          ]),
        ])
      ).toBe('partial');
    });

    it('ignores custom tokens without oracle lines', () => {
      expect(
        pricingStatusForNetworks([
          net([
            { symbol: 'ETH', usdValue: 1 },
            { symbol: 'PEPE', usdValue: null },
          ]),
        ])
      ).toBe('complete');
    });
  });
});
