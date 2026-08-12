import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-i18n', () => ({
  t: {
    subscribe: (fn: (v: (k: string, opts?: { values?: Record<string, string> }) => string) => void) => {
      fn((k, opts) => (opts?.values ? `${k}:${JSON.stringify(opts.values)}` : k));
      return () => {};
    },
  },
}));

import {
  displayGovWriteFundingHint,
  govWriteFundingFallbackHint,
  govWriteFundingHint,
  govWriteNoSponsorHint,
  govWriteSubmittedToast,
  resolveGovWriteFundingMode,
} from './gov-write-funding';

describe('govWriteFundingHint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns i18n keys for sponsored vs self-funded', () => {
    expect(govWriteFundingHint('sponsored')).toBe('governance.funding.sponsored');
    expect(govWriteFundingHint('self_funded')).toBe('governance.funding.selfFunded');
  });

  it('fallback and no-sponsor return keys', () => {
    expect(govWriteFundingFallbackHint()).toBe('governance.funding.fallback');
    expect(govWriteNoSponsorHint()).toBe('governance.funding.noSponsor');
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

describe('govWriteSubmittedToast', () => {
  it('picks mode-specific toast keys', () => {
    expect(govWriteSubmittedToast('Vote', 'sponsored')).toBe(
      'governance.toast.submittedSponsored:{"label":"Vote"}',
    );
    expect(govWriteSubmittedToast('Vote', 'self_funded')).toBe(
      'governance.toast.submittedSelfFunded:{"label":"Vote"}',
    );
    expect(govWriteSubmittedToast('Vote', null)).toBe(
      'governance.toast.submitted:{"label":"Vote"}',
    );
  });
});
