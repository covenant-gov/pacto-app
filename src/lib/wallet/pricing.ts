/**
 * USD display prices from Chainlink Data Feeds (via Tauri `wallet_get_usd_spot_prices`).
 * Feeds follow the wallet network (mainnet / arbitrum / sepolia; local → sepolia).
 * There are no static price fallbacks: if the oracle/RPC path fails, callers get an error result.
 */

import { invoke } from '@tauri-apps/api/core';
import type { WalletAssetCode } from './assets';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

function isKnownUsdAsset(code: string): code is WalletAssetCode {
  return code === 'ETH' || code === 'USDC' || code === 'USDT';
}

export interface WalletUsdSpotPrices {
  ethUsd: number;
  usdcUsd: number;
  usdtUsd: number;
  /** On success, `chainlink`. */
  source: string;
  /** Resolved feed network: `ethereum-mainnet` | `arbitrum` | `sepolia`. */
  feedNetwork: string;
  fetchedAtMsEpoch: number;
}

export type WalletUsdSpotPricesResult =
  | { ok: true; prices: WalletUsdSpotPrices }
  | { ok: false; message: string };

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as { __TAURI__?: unknown }).__TAURI__;
}

const userFacingOracleFailure = (): string => get(t)('wallet.errors.usdPricesUnavailable');

/**
 * Fetches Chainlink-backed USD spot prices for `networkKey` (90s server-side cache per feed network).
 * Returns `ok: false` when not in Tauri or when the oracle/RPC call fails — never fabricates rates.
 */
export async function getWalletUsdSpotPrices(
  networkKey: string
): Promise<WalletUsdSpotPricesResult> {
  if (!isTauri()) {
    return {
      ok: false,
      message:
        'USD prices from Chainlink are only available in the Pacto desktop app (Tauri), not in a plain browser preview.',
    };
  }
  try {
    const prices = await invoke<WalletUsdSpotPrices>('wallet_get_usd_spot_prices', {
      networkKey,
    });
    return { ok: true, prices };
  } catch {
    return { ok: false, message: userFacingOracleFailure() };
  }
}

function usdPerUnit(prices: WalletUsdSpotPrices, code: WalletAssetCode): number {
  switch (code) {
    case 'ETH':
      return prices.ethUsd;
    case 'USDC':
      return prices.usdcUsd;
    case 'USDT':
      return prices.usdtUsd;
    default:
      return 0;
  }
}

/**
 * Converts a human decimal amount string to a USD estimate using live oracle prices.
 * Returns `null` if the amount is invalid or the rate is non-finite.
 */
export function amountToApproxUsd(
  amountDecimal: string,
  assetCode: string,
  prices: WalletUsdSpotPrices
): number | null {
  const n = Number.parseFloat(amountDecimal.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  if (!isKnownUsdAsset(assetCode)) return null;
  const rate = usdPerUnit(prices, assetCode);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return n * rate;
}

/**
 * Formats a USD number for display (e.g. modal subtitle).
 */
export function formatApproxUsd(usd: number): string {
  if (!Number.isFinite(usd)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: usd >= 100 ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(usd);
}
