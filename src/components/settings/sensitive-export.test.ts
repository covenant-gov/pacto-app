import { describe, expect, it } from 'vitest';
import { formatExportAddress, parseExportBackoffSeconds } from './sensitive-export';

describe('parseExportBackoffSeconds', () => {
  it('reads the wait from the backend rate-limit error', () => {
    expect(
      parseExportBackoffSeconds('Too many export attempts. Please wait 12 seconds.')
    ).toBe(12);
  });

  it('returns null for other failures', () => {
    expect(parseExportBackoffSeconds('Incorrect PIN')).toBeNull();
    expect(parseExportBackoffSeconds('Please wait 0 seconds.')).toBeNull();
  });
});

describe('formatExportAddress', () => {
  it('keeps short addresses intact and truncates long ones', () => {
    expect(formatExportAddress('0xAbC')).toBe('0xAbC');
    expect(formatExportAddress('0xabc0000000000000000000000000000000abc')).toBe('0xabc000…000abc');
  });
});
