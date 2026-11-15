const RAW_INT = /^-?\d+$/;

/** Fractional digits for user-facing crypto amounts (wallets, treasury, Safe, gas). */
export const CRYPTO_DISPLAY_DECIMALS = 6;

function parseRawAmount(raw: bigint | string): bigint | null {
  if (typeof raw === 'bigint') return raw;
  const trimmed = raw.trim();
  if (!RAW_INT.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

/** Fixed-width decimal at full token precision. Fractional digits are padded; trailing zeros stay. */
export function formatTokenAmount(raw: bigint | string, decimals: number): string | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  const value = parseRawAmount(raw);
  if (value === null) return null;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const sign = negative ? '-' : '';
  if (decimals === 0) return `${sign}${abs.toString()}`;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, '0');
  return `${sign}${whole.toString()}.${frac}`;
}

/**
 * Lossless decimal at full token precision: trailing fractional zeros are trimmed down to
 * `minDecimals` digits. Use where the reader must see the exact amount (for example proposals).
 */
export function formatTokenAmountExact(
  raw: bigint | string,
  tokenDecimals: number,
  minDecimals: number = CRYPTO_DISPLAY_DECIMALS,
): string | null {
  if (!Number.isInteger(minDecimals) || minDecimals < 0 || minDecimals > 255) return null;
  const full = formatTokenAmount(raw, tokenDecimals);
  if (full === null) return null;
  const [whole, frac = ''] = full.split('.');
  const trimmed = frac.replace(/0+$/, '').padEnd(minDecimals, '0');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/**
 * Round a raw token amount to a fixed display width (default 6 fractional digits).
 * Uses half-up rounding when the token has more precision than the display width.
 * A nonzero amount that would round to zero is shown at full precision instead.
 */
export function formatTokenAmountForDisplay(
  raw: bigint | string,
  tokenDecimals: number,
  displayDecimals: number = CRYPTO_DISPLAY_DECIMALS,
): string | null {
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 255) return null;
  if (!Number.isInteger(displayDecimals) || displayDecimals < 0 || displayDecimals > 255) return null;

  const value = parseRawAmount(raw);
  if (value === null) return null;

  const negative = value < 0n;
  const abs = negative ? -value : value;
  const sign = negative ? '-' : '';

  if (tokenDecimals <= displayDecimals) {
    const full = formatTokenAmount(abs, tokenDecimals);
    if (full === null) return null;
    if (displayDecimals === 0) return `${sign}${full}`;
    if (tokenDecimals === 0) {
      return `${sign}${full}.${'0'.repeat(displayDecimals)}`;
    }
    const [whole, frac = ''] = full.split('.');
    return `${sign}${whole}.${frac.padEnd(displayDecimals, '0')}`;
  }

  const drop = BigInt(tokenDecimals - displayDecimals);
  const divisor = 10n ** drop;
  const half = divisor / 2n;
  const rounded = (abs + half) / divisor;
  if (rounded === 0n && abs > 0n) return formatTokenAmount(value, tokenDecimals);
  const scaled = negative ? -rounded : rounded;
  return formatTokenAmount(scaled, displayDecimals);
}

/**
 * Display only: rounded, never feed the result into signing or send. Use `weiToEthExactString`
 * or the raw amount for value paths. ETH is always 18 token decimals; other symbols use
 * `decimals` from the token record.
 */
export function formatAssetAmount(
  raw: bigint | string,
  asset: { symbol: string; decimals?: number },
  displayDecimals: number = CRYPTO_DISPLAY_DECIMALS,
): string | null {
  const decimals = asset.symbol === 'ETH' ? 18 : asset.decimals;
  if (decimals == null) return null;
  return formatTokenAmountForDisplay(raw, decimals, displayDecimals);
}
