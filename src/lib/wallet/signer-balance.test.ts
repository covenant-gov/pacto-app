import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  amountExceedsBalance,
  canonicalAddress,
  emptyBalance,
  reconcileSignerWallet,
  shortAddress,
  shouldPreferFundedDefault,
} from './signer-balance';

const addrA = getAddress('0x51012bcd8494f36b000000000000000000000001');
const addrB = getAddress('0x897aae53a87e2d69000000000000000000000002');

describe('canonicalAddress', () => {
  it('checksums valid addresses and nulls invalid input', () => {
    expect(canonicalAddress(addrA.toLowerCase())).toBe(addrA);
    expect(canonicalAddress('not-an-address')).toBeNull();
    expect(canonicalAddress('')).toBeNull();
    expect(canonicalAddress(null)).toBeNull();
    expect(canonicalAddress(undefined)).toBeNull();
  });
});

describe('shortAddress', () => {
  it('truncates long addresses and passes short ones through', () => {
    expect(shortAddress(addrA)).toBe(`${addrA.slice(0, 10)}…${addrA.slice(-8)}`);
    expect(shortAddress('0x1234')).toBe('0x1234');
    expect(shortAddress(null)).toBe('Not set');
  });
});

describe('amountExceedsBalance', () => {
  it('flags amounts that leave no room for gas', () => {
    expect(amountExceedsBalance('1', '1000000000000000000')).toBe(true);
    expect(amountExceedsBalance('0.5', '1000000000000000000')).toBe(false);
    expect(amountExceedsBalance('1,5', '2500000000000000000')).toBe(true);
  });

  it('never flags on unparseable input', () => {
    expect(amountExceedsBalance('abc', '1000000000000000000')).toBe(false);
    expect(amountExceedsBalance('1', 'not-wei')).toBe(false);
  });
});

describe('emptyBalance', () => {
  it('returns a zeroed idle balance', () => {
    expect(emptyBalance()).toEqual({
      balanceRaw: '0',
      balanceDecimal: '0',
      symbol: 'ETH',
      loading: false,
      error: '',
    });
  });
});

describe('reconcileSignerWallet', () => {
  it('forces squad when both signers resolve to the same address', () => {
    expect(reconcileSignerWallet('default', addrA, addrA.toLowerCase())).toBe('squad');
  });

  it('falls back to whichever signer exists', () => {
    expect(reconcileSignerWallet('default', null, addrB)).toBe('squad');
    expect(reconcileSignerWallet('squad', addrA, null)).toBe('default');
  });

  it('keeps the current choice otherwise', () => {
    expect(reconcileSignerWallet('default', addrA, addrB)).toBe('default');
    expect(reconcileSignerWallet('squad', addrA, addrB)).toBe('squad');
    expect(reconcileSignerWallet('squad', null, null)).toBe('squad');
  });
});

describe('shouldPreferFundedDefault', () => {
  it('prefers Default only when roster is empty and Default is funded', () => {
    expect(
      shouldPreferFundedDefault({
        defaultSignerAddress: addrA,
        squadSignerAddress: addrB,
        defaultBalanceRaw: '100',
        squadBalanceRaw: '0',
      }),
    ).toBe(true);
    expect(
      shouldPreferFundedDefault({
        defaultSignerAddress: addrA,
        squadSignerAddress: addrB,
        defaultBalanceRaw: '100',
        squadBalanceRaw: '5',
      }),
    ).toBe(false);
  });

  it('never prefers Default when signers match or one is missing', () => {
    expect(
      shouldPreferFundedDefault({
        defaultSignerAddress: addrA,
        squadSignerAddress: addrA,
        defaultBalanceRaw: '100',
        squadBalanceRaw: '0',
      }),
    ).toBe(false);
    expect(
      shouldPreferFundedDefault({
        defaultSignerAddress: null,
        squadSignerAddress: addrB,
        defaultBalanceRaw: '100',
        squadBalanceRaw: '0',
      }),
    ).toBe(false);
  });
});
