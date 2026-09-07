import { describe, expect, it } from 'vitest';
import { parseOptionalDepositWei } from './sponsor-deposit';
import { showUsernameNftSponsorNote } from './username-nft-eligibility';

describe('parseOptionalDepositWei', () => {
  it('treats empty input as zero', () => {
    expect(parseOptionalDepositWei('')).toBe(0n);
  });

  it('parses decimal eth amounts', () => {
    expect(parseOptionalDepositWei('0.01')).toBe(10000000000000000n);
  });

  it('rejects invalid amounts', () => {
    expect(parseOptionalDepositWei('not-eth')).toBeNull();
  });
});

describe('showUsernameNftSponsorNote', () => {
  it('shows for squad payer when roster is eligible', () => {
    expect(
      showUsernameNftSponsorNote({
        payFrom: 'squad',
        eligibility: { squadSignerEligible: true, captainEligible: false },
      }),
    ).toBe(true);
  });

  it('shows for default payer when captain or squad is eligible', () => {
    expect(
      showUsernameNftSponsorNote({
        payFrom: 'default',
        eligibility: { squadSignerEligible: false, captainEligible: true },
      }),
    ).toBe(true);
  });

  it('hides when no eligible member', () => {
    expect(
      showUsernameNftSponsorNote({
        payFrom: 'default',
        eligibility: { squadSignerEligible: false, captainEligible: false },
      }),
    ).toBe(false);
  });
});
