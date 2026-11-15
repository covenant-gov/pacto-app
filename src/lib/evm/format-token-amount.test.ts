import { describe, expect, it } from 'vitest';
import {
  CRYPTO_DISPLAY_DECIMALS,
  formatAssetAmount,
  formatTokenAmount,
  formatTokenAmountExact,
  formatTokenAmountForDisplay,
} from './format-token-amount';

describe('formatTokenAmount', () => {
  it('pads ETH wei to 18 places', () => {
    expect(formatTokenAmount(0n, 18)).toBe('0.000000000000000000');
    expect(formatTokenAmount('0', 18)).toBe('0.000000000000000000');
    expect(formatTokenAmount('1000000000000000000', 18)).toBe('1.000000000000000000');
    expect(formatTokenAmount('1000000000000000', 18)).toBe('0.001000000000000000');
    expect(formatTokenAmount('949995365328042385', 18)).toBe('0.949995365328042385');
    expect(formatTokenAmount('1395633240123456000', 18)).toBe('1.395633240123456000');
  });

  it('pads other token decimals and keeps a zero-decimal integer', () => {
    expect(formatTokenAmount(1_000_000n, 6)).toBe('1.000000');
    expect(formatTokenAmount('1500000', 6)).toBe('1.500000');
    expect(formatTokenAmount(5n, 0)).toBe('5');
  });

  it('rejects junk, blank input, and out-of-range decimals', () => {
    expect(formatTokenAmount('not-a-number', 18)).toBeNull();
    expect(formatTokenAmount('', 18)).toBeNull();
    expect(formatTokenAmount('1.5', 18)).toBeNull();
    expect(formatTokenAmount('1', 1.5)).toBeNull();
    expect(formatTokenAmount('1', -1)).toBeNull();
    expect(formatTokenAmount('1', 256)).toBeNull();
  });
});

describe('formatTokenAmountExact', () => {
  it('pads to six decimals and extends to full precision only when needed', () => {
    expect(formatTokenAmountExact('0', 18)).toBe('0.000000');
    expect(formatTokenAmountExact('1500000000000000000', 18)).toBe('1.500000');
    expect(formatTokenAmountExact('1234567500000000000', 18)).toBe('1.2345675');
    expect(formatTokenAmountExact('1', 18)).toBe('0.000000000000000001');
    expect(formatTokenAmountExact('-1500000', 6)).toBe('-1.500000');
  });

  it('rejects junk and bad min decimals', () => {
    expect(formatTokenAmountExact('x', 18)).toBeNull();
    expect(formatTokenAmountExact('1', 18, -1)).toBeNull();
  });
});

describe('formatTokenAmountForDisplay', () => {
  it('defaults to six fractional digits', () => {
    expect(CRYPTO_DISPLAY_DECIMALS).toBe(6);
    expect(formatTokenAmountForDisplay(0n, 18)).toBe('0.000000');
    expect(formatTokenAmountForDisplay('1000000000000000000', 18)).toBe('1.000000');
    expect(formatTokenAmountForDisplay('1000000000000000', 18)).toBe('0.001000');
  });

  it('rounds half-up when truncating extra precision', () => {
    expect(formatTokenAmountForDisplay('949995365328042385', 18)).toBe('0.949995');
    expect(formatTokenAmountForDisplay('949995500000000000', 18)).toBe('0.949996');
    expect(formatTokenAmountForDisplay('1395633240123456000', 18)).toBe('1.395633');
  });

  it('shows full precision for a nonzero amount that would round to zero', () => {
    expect(formatTokenAmountForDisplay('400000000000', 18)).toBe('0.000000400000000000');
    expect(formatTokenAmountForDisplay('1', 18)).toBe('0.000000000000000001');
    expect(formatTokenAmountForDisplay('-1', 18)).toBe('-0.000000000000000001');
    expect(formatTokenAmountForDisplay('499999999999', 18)).toBe('0.000000499999999999');
    expect(formatTokenAmountForDisplay('500000000000', 18)).toBe('0.000001');
  });

  it('pads tokens that already use six or fewer decimals', () => {
    expect(formatTokenAmountForDisplay('1500000', 6)).toBe('1.500000');
    expect(formatTokenAmountForDisplay(5n, 0)).toBe('5.000000');
    expect(formatTokenAmountForDisplay('12', 2)).toBe('0.120000');
  });

  it('rejects junk and out-of-range decimals', () => {
    expect(formatTokenAmountForDisplay('not-a-number', 18)).toBeNull();
    expect(formatTokenAmountForDisplay('1', -1)).toBeNull();
    expect(formatTokenAmountForDisplay('1', 18, -1)).toBeNull();
  });
});

describe('formatAssetAmount', () => {
  it('displays ETH at six fractional digits', () => {
    expect(formatAssetAmount('1000000000000000000', { symbol: 'ETH' })).toBe('1.000000');
    expect(formatAssetAmount('1000000', { symbol: 'ETH', decimals: 6 })).toBe('0.000000000001000000');
    expect(formatAssetAmount(0n, { symbol: 'ETH' })).toBe('0.000000');
  });

  it('uses the token decimals for anything else, then six display digits', () => {
    expect(formatAssetAmount('1500000', { symbol: 'USDC', decimals: 6 })).toBe('1.500000');
    expect(formatAssetAmount('1500000', { symbol: 'USDC' })).toBeNull();
  });
});
