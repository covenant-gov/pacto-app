import { describe, it, expect } from 'vitest';
import { normalizeLeadingDotDecimalInput } from './amount-input';

describe('normalizeLeadingDotDecimalInput', () => {
  it('prefixes 0 when value starts with a dot', () => {
    expect(normalizeLeadingDotDecimalInput('.1')).toBe('0.1');
    expect(normalizeLeadingDotDecimalInput('.00001')).toBe('0.00001');
  });

  it('turns lone dot into 0.', () => {
    expect(normalizeLeadingDotDecimalInput('.')).toBe('0.');
  });

  it('preserves values that already have an integer part', () => {
    expect(normalizeLeadingDotDecimalInput('0.1')).toBe('0.1');
    expect(normalizeLeadingDotDecimalInput('10.5')).toBe('10.5');
  });

  it('handles leading whitespace before the dot', () => {
    expect(normalizeLeadingDotDecimalInput('  .25')).toBe('  0.25');
  });

  it('leaves empty and non-leading-dot strings unchanged aside from no match', () => {
    expect(normalizeLeadingDotDecimalInput('')).toBe('');
    expect(normalizeLeadingDotDecimalInput('1')).toBe('1');
  });
});
