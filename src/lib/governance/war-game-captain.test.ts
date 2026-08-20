import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  pickRandomRosterCaptain,
  randomizeCaptainCandidates,
  uniqueRosterAddresses,
} from './war-game-captain';

const A = getAddress('0x1111111111111111111111111111111111111111');
const B = getAddress('0x2222222222222222222222222222222222222222');
const C = getAddress('0x3333333333333333333333333333333333333333');

describe('uniqueRosterAddresses', () => {
  it('checksums, skips junk, and dedupes', () => {
    expect(uniqueRosterAddresses(['', 'nope', A, A.toLowerCase(), B])).toEqual([A, B]);
  });
});

describe('randomizeCaptainCandidates', () => {
  it('drops the current captain and extra wearers', () => {
    expect(
      randomizeCaptainCandidates([{ address: A }, { address: B }, { address: C }], [A, C]),
    ).toEqual([B]);
  });

  it('returns empty when only the captain has a bound EVM', () => {
    expect(randomizeCaptainCandidates([{ address: A }], A)).toEqual([]);
    expect(randomizeCaptainCandidates([], A)).toEqual([]);
  });
});

describe('pickRandomRosterCaptain', () => {
  it('returns null when the pool is empty', () => {
    expect(pickRandomRosterCaptain([])).toBeNull();
    expect(pickRandomRosterCaptain([{ address: 'nope' }])).toBeNull();
    expect(pickRandomRosterCaptain([{ address: A }], A)).toBeNull();
  });

  it('never picks the excluded captain', () => {
    expect(pickRandomRosterCaptain([{ address: A }, { address: B }], A, () => 0)).toBe(B);
  });

  it('uses the injected index', () => {
    expect(
      pickRandomRosterCaptain([{ address: A }, { address: B }, { address: C }], A, () => 1),
    ).toBe(C);
    expect(
      pickRandomRosterCaptain([{ address: A }, { address: B }, { address: C }], A, () => 0),
    ).toBe(B);
  });

  it('falls back to the first candidate when the index is out of range', () => {
    expect(pickRandomRosterCaptain([{ address: A }, { address: B }], A, () => 9)).toBe(B);
  });
});
