import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { pickRandomRosterCaptain, uniqueRosterAddresses } from './war-game-captain';

const A = getAddress('0x1111111111111111111111111111111111111111');
const B = getAddress('0x2222222222222222222222222222222222222222');

describe('uniqueRosterAddresses', () => {
  it('checksums, skips junk, and dedupes', () => {
    expect(uniqueRosterAddresses(['', 'nope', A, A.toLowerCase(), B])).toEqual([A, B]);
  });
});

describe('pickRandomRosterCaptain', () => {
  it('returns null when the roster has no EVMs', () => {
    expect(pickRandomRosterCaptain([])).toBeNull();
    expect(pickRandomRosterCaptain(['nope'])).toBeNull();
  });

  it('uses the injected index', () => {
    expect(pickRandomRosterCaptain([A, B], () => 1)).toBe(B);
    expect(pickRandomRosterCaptain([A, B], () => 0)).toBe(A);
  });

  it('falls back to the first address when the index is out of range', () => {
    expect(pickRandomRosterCaptain([A, B], () => 9)).toBe(A);
  });
});
