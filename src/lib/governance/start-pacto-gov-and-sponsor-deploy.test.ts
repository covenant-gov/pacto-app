import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  bootstrapCrewCandidates,
  canBootstrapCrewDuringDeploy,
  isRosterHatRecipientAddress,
} from './start-pacto-gov-and-sponsor-deploy';

const rosterA = getAddress('0x51012bcd8494f36b000000000000000000000001');
const rosterB = getAddress('0x897aae53a87e2d69000000000000000000000002');
const defaultOnly = getAddress('0xdbe38ac51289df3714cb3e4a104aeb71920af98a');

describe('isRosterHatRecipientAddress', () => {
  const opts = [{ address: rosterA }, { address: rosterB }];

  it('accepts squad-assigned roster EVMs', () => {
    expect(isRosterHatRecipientAddress(rosterA, opts)).toBe(true);
    expect(isRosterHatRecipientAddress(rosterB.toLowerCase(), opts)).toBe(true);
  });

  it('rejects Default (or any) address not on the roster map', () => {
    expect(isRosterHatRecipientAddress(defaultOnly, opts)).toBe(false);
  });
});

describe('canBootstrapCrewDuringDeploy', () => {
  it('allows squad payer who is also captain', () => {
    expect(
      canBootstrapCrewDuringDeploy({
        signerWallet: 'squad',
        captainAddress: rosterA,
        squadRosterAddress: rosterA,
      }),
    ).toBe(true);
  });

  it('allows Default payer when captain is self (sponsored mint path)', () => {
    expect(
      canBootstrapCrewDuringDeploy({
        signerWallet: 'default',
        captainAddress: rosterA,
        squadRosterAddress: rosterA,
      }),
    ).toBe(true);
  });

  it('disallows squad payer who named someone else captain', () => {
    expect(
      canBootstrapCrewDuringDeploy({
        signerWallet: 'squad',
        captainAddress: rosterB,
        squadRosterAddress: rosterA,
      }),
    ).toBe(false);
  });

  it('treats identical Default/squad addresses as squad payer', () => {
    expect(
      canBootstrapCrewDuringDeploy({
        signerWallet: 'default',
        signersAreSame: true,
        captainAddress: rosterA,
        squadRosterAddress: rosterA,
      }),
    ).toBe(true);
  });
});

describe('bootstrapCrewCandidates', () => {
  it('only yields roster options and excludes captain', () => {
    const out = bootstrapCrewCandidates(
      [{ address: rosterA }, { address: rosterB }],
      rosterA,
    );
    expect(out).toEqual([rosterB]);
  });
});
