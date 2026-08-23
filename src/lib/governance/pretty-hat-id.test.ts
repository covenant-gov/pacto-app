import { describe, expect, it } from 'vitest';
import { displayHatsTreeId, hatsTreeDomain, hatIdToHex, prettyHatId } from './pretty-hat-id';

describe('hatsTreeDomain', () => {
  it('passes through bare tree domains', () => {
    expect(hatsTreeDomain('950')).toBe('950');
    expect(hatsTreeDomain('0x12a')).toBe('298');
  });

  it('extracts domain from a packed top-hat uint256', () => {
    const packed = (BigInt(950) << 224n).toString(10);
    expect(hatsTreeDomain(packed)).toBe('950');
    expect(
      hatsTreeDomain(
        '0x000003b600000000000000000000000000000000000000000000000000000000',
      ),
    ).toBe('950');
  });

  it('returns null for invalid input', () => {
    expect(hatsTreeDomain('')).toBeNull();
    expect(hatsTreeDomain('nope')).toBeNull();
  });
});

describe('displayHatsTreeId', () => {
  it('prefers the tree domain for labels', () => {
    expect(displayHatsTreeId('3660')).toBe('3660');
    expect(displayHatsTreeId((BigInt(3660) << 224n).toString(10))).toBe('3660');
  });

  it('returns empty for missing or invalid ids', () => {
    expect(displayHatsTreeId('')).toBe('');
    expect(displayHatsTreeId('nope')).toBe('nope');
  });
});

describe('hatIdToHex', () => {
  it('packs a bare tree domain into a top-hat hex id', () => {
    expect(hatIdToHex('950')).toBe(
      '0x000003b600000000000000000000000000000000000000000000000000000000',
    );
  });

  it('formats a packed decimal hat id as hex', () => {
    const packed = BigInt(950) << 224n;
    expect(hatIdToHex(packed.toString(10))).toBe(
      '0x000003b600000000000000000000000000000000000000000000000000000000',
    );
  });
});

describe('prettyHatId', () => {
  it('formats the Hats docs hex example as IP-style id', () => {
    // 0x0000000f.0002.0005.000a.0001 → 15.2.5.10.1
    expect(
      prettyHatId(
        '0x0000000f00020005000a00010000000000000000000000000000000000000000',
      ),
    ).toBe('15.2.5.10.1');
  });

  it('formats the Hats docs level-2 example', () => {
    // 0x00000001.0002.0003 → 1.2.3
    expect(
      prettyHatId(
        '0x0000000100020003000000000000000000000000000000000000000000000000',
      ),
    ).toBe('1.2.3');
  });

  it('formats a top hat as tree domain only', () => {
    expect(
      prettyHatId(
        '0x0000000100000000000000000000000000000000000000000000000000000000',
      ),
    ).toBe('1');
  });

  it('accepts decimal uint256 input', () => {
    const hex = '0x0000000f00020005000a00010000000000000000000000000000000000000000';
    const decimal = BigInt(hex).toString(10);
    expect(prettyHatId(decimal)).toBe('15.2.5.10.1');
  });

  it('round-trips a dotted pretty id', () => {
    expect(prettyHatId('15.2.5.10.1')).toBe('15.2.5.10.1');
    expect(hatIdToHex('15.2.5.10.1')).toBe(
      '0x0000000f00020005000a00010000000000000000000000000000000000000000',
    );
  });

  it('returns null for empty or invalid input', () => {
    expect(prettyHatId('')).toBeNull();
    expect(prettyHatId('  ')).toBeNull();
    expect(prettyHatId('not-a-hat')).toBeNull();
  });

  it('formats tree domain 298 top hat from decimal domain-style id', () => {
    expect(prettyHatId('298')).toBe('298');
    const packed = BigInt(298) << 224n;
    expect(prettyHatId(packed.toString(10))).toBe('298');
  });
});
