import { describe, expect, it } from 'vitest';
import { govWriteFundingFallbackHint, govWriteFundingHint } from './gov-write-funding';

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
