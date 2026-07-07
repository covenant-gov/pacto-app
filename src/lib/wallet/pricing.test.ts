import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  getWalletUsdSpotPrices,
  amountToApproxUsd,
  formatApproxUsd,
  type WalletUsdSpotPricesResult,
} from './pricing';

function failureMessage(outcome: WalletUsdSpotPricesResult): string {
  if (outcome.ok) throw new Error('expected failure outcome');
  return outcome.message;
}

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

describe('pricing', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getWalletUsdSpotPrices', () => {
    it('returns a browser-only error when not running in Tauri', async () => {
      vi.stubGlobal('window', undefined);
      const result = await getWalletUsdSpotPrices();
      expect(result.ok).toBe(false);
      expect(failureMessage(result)).toContain('Pacto desktop app');
      expect(mockedInvoke).not.toHaveBeenCalled();
    });

    it('invokes wallet_get_usd_spot_prices and returns prices in Tauri', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      const prices = {
        ethUsd: 3500,
        usdcUsd: 1,
        usdtUsd: 0.99,
        source: 'chainlink',
        feedNetwork: 'mainnet',
        fetchedAtMsEpoch: 1710000000000,
      };
      mockedInvoke.mockResolvedValueOnce(prices);
      const result = await getWalletUsdSpotPrices();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.prices).toEqual(prices);
      }
      expect(mockedInvoke).toHaveBeenCalledWith('wallet_get_usd_spot_prices');
    });

    it('returns a user-facing error when the invoke fails', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      mockedInvoke.mockRejectedValueOnce(new Error('rpc down'));
      const result = await getWalletUsdSpotPrices();
      expect(result.ok).toBe(false);
      expect(failureMessage(result)).toContain('Live USD prices are unavailable');
    });
  });

  describe('amountToApproxUsd', () => {
    const prices = {
      ethUsd: 3500,
      usdcUsd: 1,
      usdtUsd: 0.99,
      source: 'chainlink',
      feedNetwork: 'mainnet',
      fetchedAtMsEpoch: 1710000000000,
    };

    it('returns null for invalid, negative, or blank amounts', () => {
      expect(amountToApproxUsd('', 'ETH', prices)).toBeNull();
      expect(amountToApproxUsd('not-a-number', 'ETH', prices)).toBeNull();
      expect(amountToApproxUsd('-1', 'ETH', prices)).toBeNull();
      expect(amountToApproxUsd('  ', 'ETH', prices)).toBeNull();
    });

    it('returns null for unknown assets', () => {
      expect(amountToApproxUsd('1', 'BTC', prices)).toBeNull();
    });

    it('returns null when the price is non-positive', () => {
      expect(amountToApproxUsd('1', 'ETH', { ...prices, ethUsd: 0 })).toBeNull();
      expect(amountToApproxUsd('1', 'ETH', { ...prices, ethUsd: Number.NaN })).toBeNull();
    });

    it('converts a valid amount to USD using the live price', () => {
      expect(amountToApproxUsd('2', 'ETH', prices)).toBe(7000);
      expect(amountToApproxUsd('100', 'USDC', prices)).toBe(100);
      expect(amountToApproxUsd('100', 'USDT', prices)).toBe(99);
    });
  });

  describe('formatApproxUsd', () => {
    it('returns an em-dash for non-finite values', () => {
      expect(formatApproxUsd(Number.NaN)).toBe('—');
      expect(formatApproxUsd(Number.POSITIVE_INFINITY)).toBe('—');
    });

    it('formats small amounts with up to two decimals', () => {
      expect(formatApproxUsd(99.99)).toBe('$99.99');
      expect(formatApproxUsd(0.5)).toBe('$0.5');
    });

    it('formats large amounts without decimals', () => {
      expect(formatApproxUsd(100)).toBe('$100');
      expect(formatApproxUsd(12345.67)).toBe('$12,346');
    });
  });
});
