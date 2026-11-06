import { describe, expect, it } from 'vitest';
import { formatAssetAmount, formatTokenAmount } from './format-token-amount';

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

describe('formatAssetAmount', () => {
  it('forces 18 decimals for ETH', () => {
    expect(formatAssetAmount('1000000000000000000', { symbol: 'ETH' })).toBe('1.000000000000000000');
    expect(formatAssetAmount('1000000', { symbol: 'ETH', decimals: 6 })).toBe('0.000000000001000000');
  });

  it('uses the token decimals for anything else', () => {
    expect(formatAssetAmount('1500000', { symbol: 'USDC', decimals: 6 })).toBe('1.500000');
    expect(formatAssetAmount('1500000', { symbol: 'USDC' })).toBeNull();
  });
});
