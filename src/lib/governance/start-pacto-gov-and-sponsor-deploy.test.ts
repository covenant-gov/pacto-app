import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  bootstrapCrewCandidates,
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

describe('bootstrapCrewCandidates', () => {
  it('only yields roster options and excludes captain', () => {
    const out = bootstrapCrewCandidates(
      [{ address: rosterA }, { address: rosterB }],
      rosterA,
    );
    expect(out).toEqual([rosterB]);
  });
});
