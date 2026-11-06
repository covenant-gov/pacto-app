const RAW_INT = /^-?\d+$/;

/** Fixed-width decimal. Fractional digits are padded and trailing zeros stay. */
export function formatTokenAmount(raw: bigint | string, decimals: number): string | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  let value: bigint;
  if (typeof raw === 'bigint') {
    value = raw;
  } else {
    const trimmed = raw.trim();
    if (!RAW_INT.test(trimmed)) return null;
    try {
      value = BigInt(trimmed);
    } catch {
      return null;
    }
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const sign = negative ? '-' : '';
  if (decimals === 0) return `${sign}${abs.toString()}`;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, '0');
  return `${sign}${whole.toString()}.${frac}`;
}

/** ETH is always 18 decimals. Other symbols use `decimals` from the token record. */
export function formatAssetAmount(
  raw: bigint | string,
  asset: { symbol: string; decimals?: number },
): string | null {
  const decimals = asset.symbol === 'ETH' ? 18 : asset.decimals;
  if (decimals == null) return null;
  return formatTokenAmount(raw, decimals);
}
