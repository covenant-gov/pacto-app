import { describe, expect, it } from 'vitest';
import {
  displayGovWriteFundingHint,
  govWriteFundingFallbackHint,
  govWriteFundingHint,
  govWriteNoSponsorHint,
  resolveGovWriteFundingMode,
} from './gov-write-funding';

describe('govWriteFundingHint', () => {
  it('distinguishes sponsored vs self-funded', () => {
    expect(govWriteFundingHint('sponsored')).toMatch(/sponsored/i);
    expect(govWriteFundingHint('self_funded')).toMatch(/squad-assigned/i);
  });

  it('fallback mentions both paths', () => {
    const copy = govWriteFundingFallbackHint();
    expect(copy).toMatch(/squad-assigned/i);
    expect(copy).toMatch(/sponsored/i);
  });
});

describe('resolveGovWriteFundingMode', () => {
  it('returns null when balance is unknown', () => {
    expect(
      resolveGovWriteFundingMode({
        balanceRaw: '0',
        balanceKnown: false,
        hasSponsorInfra: true,
      }),
    ).toBeNull();
  });

  it('prefers self_funded when roster has ETH', () => {
    expect(
      resolveGovWriteFundingMode({
        balanceRaw: '1',
        balanceKnown: true,
        hasSponsorInfra: true,
      }),
    ).toBe('self_funded');
  });

  it('prefers sponsored when zero balance and sponsor exists', () => {
    expect(
      resolveGovWriteFundingMode({
        balanceRaw: '0',
        balanceKnown: true,
        hasSponsorInfra: true,
      }),
    ).toBe('sponsored');
  });

  it('returns null when zero balance and no sponsor', () => {
    expect(
      resolveGovWriteFundingMode({
        balanceRaw: '0',
        balanceKnown: true,
        hasSponsorInfra: false,
      }),
    ).toBeNull();
  });
});

describe('displayGovWriteFundingHint', () => {
  it('uses no-sponsor copy when dry roster lacks sponsor', () => {
    expect(
      displayGovWriteFundingHint({
        balanceRaw: '0',
        balanceKnown: true,
        hasSponsorInfra: false,
      }),
    ).toBe(govWriteNoSponsorHint());
  });

  it('uses sponsored hint when dry roster has sponsor', () => {
    expect(
      displayGovWriteFundingHint({
        balanceRaw: '0',
        balanceKnown: true,
        hasSponsorInfra: true,
      }),
    ).toBe(govWriteFundingHint('sponsored'));
  });
});
