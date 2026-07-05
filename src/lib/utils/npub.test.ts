import { describe, it, expect } from 'vitest';
import { isValidNpub } from './npub';

describe('isValidNpub', () => {
  it('returns false for empty string', () => {
    expect(isValidNpub('')).toBe(false);
  });

  it('returns false for non-npub string', () => {
    expect(isValidNpub('not an npub')).toBe(false);
  });

  it('returns false for npub prefix that is too short', () => {
    expect(isValidNpub('npub1short')).toBe(false);
  });

  it('returns true for a valid-length npub1 string', () => {
    // 5 prefix chars + 52 base32 chars = 57 total
    const valid = 'npub1' + 'a'.repeat(52);
    expect(isValidNpub(valid)).toBe(true);
  });

  it('trims whitespace before validating', () => {
    const valid = 'npub1' + 'a'.repeat(52);
    expect(isValidNpub(`  ${valid}  `)).toBe(true);
    expect(isValidNpub('  npub1short  ')).toBe(false);
  });

  it('returns false for npub1 with exactly 56 chars', () => {
    const tooShort = 'npub1' + 'a'.repeat(51);
    expect(tooShort.length).toBe(56);
    expect(isValidNpub(tooShort)).toBe(false);
  });
});
