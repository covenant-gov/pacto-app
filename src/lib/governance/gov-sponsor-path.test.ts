import { describe, expect, it } from 'vitest';

/** Mirror of `gov_sponsor_path.rs` for router regression tests. */
export type GovSponsorPath = 'squad' | 'globalTopHat' | 'eoa' | 'fail';

export function selectGovSponsorPath(
  eligibleMember: boolean,
  squadPathOk: boolean,
  globalTophatOk: boolean,
  eoaCanPay: boolean,
): GovSponsorPath {
  if (eligibleMember) {
    if (squadPathOk) return 'squad';
    if (globalTophatOk) return 'globalTopHat';
    if (eoaCanPay) return 'eoa';
    return 'fail';
  }
  if (eoaCanPay) return 'eoa';
  if (squadPathOk) return 'squad';
  return 'fail';
}

describe('gov sponsor path (TS mirror)', () => {
  it('eligible member prefers squad then global then eoa', () => {
    expect(selectGovSponsorPath(true, true, true, true)).toBe('squad');
    expect(selectGovSponsorPath(true, false, true, true)).toBe('globalTopHat');
    expect(selectGovSponsorPath(true, false, false, true)).toBe('eoa');
    expect(selectGovSponsorPath(true, false, false, false)).toBe('fail');
  });

  it('non-eligible keeps eoa first then squad; global never wins', () => {
    expect(selectGovSponsorPath(false, true, true, true)).toBe('eoa');
    expect(selectGovSponsorPath(false, true, false, false)).toBe('squad');
    expect(selectGovSponsorPath(false, false, true, false)).toBe('fail');
  });

  it('cross-squad: parent B without sponsor infra does not use squad arm', () => {
    expect(selectGovSponsorPath(true, false, true, true)).toBe('globalTopHat');
    expect(selectGovSponsorPath(true, false, true, true)).not.toBe('squad');
  });

  it('factory deploy passes squadPathOk=false', () => {
    expect(selectGovSponsorPath(true, false, true, false)).toBe('globalTopHat');
    expect(selectGovSponsorPath(false, false, false, true)).toBe('eoa');
  });
});
