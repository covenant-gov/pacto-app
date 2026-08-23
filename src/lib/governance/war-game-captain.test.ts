import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  labeledWearerOptions,
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

describe('labeledWearerOptions', () => {
  it('keeps on-chain wearers missing from the MLS options list', () => {
    expect(labeledWearerOptions([B, C], [{ address: A, label: 'Captain' }])).toEqual([
      { address: B, label: `${B.slice(0, 8)}…${B.slice(-6)}` },
      { address: C, label: `${C.slice(0, 8)}…${C.slice(-6)}` },
    ]);
  });

  it('uses known roster labels and checksums', () => {
    expect(
      labeledWearerOptions([B.toLowerCase(), C], [{ address: B.toLowerCase(), label: 'bravo-test' }]),
    ).toEqual([
      { address: B, label: 'bravo-test' },
      { address: C, label: `${C.slice(0, 8)}…${C.slice(-6)}` },
    ]);
  });

  it('skips junk and dedupes', () => {
    expect(labeledWearerOptions(['', 'nope', B, B.toLowerCase()])).toEqual([
      { address: B, label: `${B.slice(0, 8)}…${B.slice(-6)}` },
    ]);
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

  it('keeps crew wearers that are missing from the MLS options list', () => {
    const pool = labeledWearerOptions([B, C], [{ address: A, label: 'Captain' }]);
    expect(randomizeCaptainCandidates(pool, A)).toEqual([B, C]);
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
