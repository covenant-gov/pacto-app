/**
 * Filter-scoped USD totals for wallet summary rows (null oracle lines are never zeroed).
 */

import type { WalletSummaryAsset, WalletSummaryNetwork, WalletUsdPricingStatus } from './backend-wallet';

const PRICED_SYMBOLS = new Set(['ETH', 'WETH', 'USDC', 'USDT']);

function isPricedAsset(asset: WalletSummaryAsset): boolean {
  return PRICED_SYMBOLS.has(asset.symbol.toUpperCase());
}

/** Sum of non-null `usdValue` lines; `null` when none are priced. */
export function sumPricedUsd(networks: WalletSummaryNetwork[]): number | null {
  let sum = 0;
  let any = false;
  for (const net of networks) {
    if (net.error) continue;
    for (const a of net.assets) {
      if (a.usdValue == null) continue;
      sum += a.usdValue;
      any = true;
    }
  }
  return any ? sum : null;
}

/**
 * Completeness for a filtered network list: only assets that normally carry oracle
 * USD (ETH / stables) count. Networks with RPC errors are ignored.
 */
export function pricingStatusForNetworks(networks: WalletSummaryNetwork[]): WalletUsdPricingStatus {
  let expected = 0;
  let priced = 0;
  for (const net of networks) {
    if (net.error) continue;
    for (const a of net.assets) {
      if (!isPricedAsset(a)) continue;
      expected += 1;
      if (a.usdValue != null) priced += 1;
    }
  }
  if (expected === 0 || priced === 0) return 'unavailable';
  if (priced === expected) return 'complete';
  return 'partial';
}
