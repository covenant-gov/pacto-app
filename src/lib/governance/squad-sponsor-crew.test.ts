import { describe, expect, it } from 'vitest';
import { allMembersShareEvmAddress, permittedByAddressFromExtStatus } from './squad-sponsor-crew';

describe('allMembersShareEvmAddress', () => {
  it('is false when there are no members', () => {
    expect(allMembersShareEvmAddress([], { a: '0x1' })).toBe(false);
  });

  it('requires every member to have a non-empty roster EVM', () => {
    const members = ['npub1', 'npub2'];
    expect(allMembersShareEvmAddress(members, { npub1: '0xabc' })).toBe(false);
    expect(
      allMembersShareEvmAddress(members, { npub1: '0xabc', npub2: '  0xdef  ' }),
    ).toBe(true);
  });
});

describe('permittedByAddressFromExtStatus', () => {
  it('maps permitted flags', () => {
    expect(
      permittedByAddressFromExtStatus([
        { address: '0xAbC', permitted: true },
        { address: '0xdef', permitted: false },
      ]),
    ).toEqual({ '0xabc': true, '0xdef': false });
  });
});
