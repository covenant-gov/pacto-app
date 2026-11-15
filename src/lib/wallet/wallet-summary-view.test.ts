import { describe, expect, it, vi } from 'vitest';
import type { WalletSummary, WalletSummaryNetwork } from './backend-wallet';
import type { SupportedChainId } from './chains';
import {
  networkErrorMessage,
  networksForBalanceList,
  summaryPricing,
  walletSummaryFetchKey,
} from './wallet-summary-view';

vi.mock('svelte-i18n', async () => {
  const { readable } = await import('svelte/store');
  const translate = (key: string, opts?: { values?: Record<string, string> }) =>
    opts?.values ? `${key}:${Object.values(opts.values).join(',')}` : key;
  return { t: readable(translate) };
});

function net(network: string, usdValue: number | null, error?: string): WalletSummaryNetwork {
  return {
    network,
    chainId: 1,
    error,
    assets: [{ symbol: 'ETH', balanceRaw: '0', balanceDecimal: '0', decimals: 18, usdValue }],
  };
}

function summary(networks: WalletSummaryNetwork[], over: Partial<WalletSummary> = {}): WalletSummary {
  return { networks, totalUsdApprox: 100, usdPricingStatus: 'complete', ...over };
}

const enabled = new Set<SupportedChainId>(['sepolia', 'mainnet'] as SupportedChainId[]);

describe('networksForBalanceList', () => {
  const s = summary([net('sepolia', 1), net('mainnet', 2), net('base', 3)]);

  it('drops disabled networks', () => {
    expect(networksForBalanceList(s, 'all', enabled).map((n) => n.network)).toEqual(['sepolia', 'mainnet']);
  });

  it('narrows to the filtered network', () => {
    expect(networksForBalanceList(s, 'mainnet' as SupportedChainId, enabled).map((n) => n.network)).toEqual([
      'mainnet',
    ]);
  });

  it('is empty without a summary', () => {
    expect(networksForBalanceList(null, 'all', enabled)).toEqual([]);
  });
});

describe('summaryPricing', () => {
  it('is unavailable without a summary', () => {
    expect(summaryPricing(null, 'all', [])).toEqual({ status: 'unavailable', total: null });
  });

  it('uses the backend total for all networks', () => {
    const s = summary([net('sepolia', 1)]);
    expect(summaryPricing(s, 'all', s.networks)).toEqual({ status: 'complete', total: 100 });
  });

  it('sums listed networks when the backend total is missing', () => {
    const s = summary([net('sepolia', 1), net('mainnet', 2)], { totalUsdApprox: null, usdPricingStatus: 'partial' });
    expect(summaryPricing(s, 'all', s.networks)).toEqual({ status: 'partial', total: 3 });
  });

  it('has no total when pricing is unavailable', () => {
    const s = summary([net('sepolia', null)], { usdPricingStatus: 'unavailable' });
    expect(summaryPricing(s, 'all', s.networks)).toEqual({ status: 'unavailable', total: null });
  });

  it('prices only the filtered networks', () => {
    const s = summary([net('sepolia', 1), net('mainnet', 2)]);
    expect(summaryPricing(s, 'mainnet' as SupportedChainId, [s.networks[1]])).toEqual({
      status: 'complete',
      total: 2,
    });
  });
});

describe('networkErrorMessage', () => {
  it('uses the Anvil copy for the local network', () => {
    expect(networkErrorMessage(net('local', null, 'x'))).toBe('wallet.anvilNotDetected');
  });

  it('names the unreachable network otherwise', () => {
    expect(networkErrorMessage(net('sepolia', null, 'x'))).toContain('wallet.couldNotReachNetwork');
  });
});

describe('walletSummaryFetchKey', () => {
  const wire = [{ network: 'sepolia', address: '0xAb', symbol: 'X', decimals: 6 }] as never;

  it('is stable for identical inputs', () => {
    const chains = ['sepolia'] as SupportedChainId[];
    expect(walletSummaryFetchKey('0x1', chains, wire)).toBe(walletSummaryFetchKey('0x1', chains, wire));
  });

  it('changes with address, chains or watched tokens', () => {
    const chains = ['sepolia'] as SupportedChainId[];
    const base = walletSummaryFetchKey('0x1', chains, wire);
    expect(walletSummaryFetchKey('0x2', chains, wire)).not.toBe(base);
    expect(walletSummaryFetchKey('0x1', ['mainnet'] as SupportedChainId[], wire)).not.toBe(base);
    expect(walletSummaryFetchKey('0x1', chains, [])).not.toBe(base);
  });
});
