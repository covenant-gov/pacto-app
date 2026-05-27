import { describe, expect, it } from 'vitest';
import {
  buildCalldataFromAbiForm,
  ethAmountToWeiString,
  isSquadInfraTargetAddress,
  normalizeCalldataHex,
  normalizeToAddress,
} from './calldata-builder';
import { loadShippedAbi } from './abi-loader';

describe('calldata-builder', () => {
  it('normalizes calldata hex', () => {
    expect(normalizeCalldataHex('')).toBe('0x');
    expect(normalizeCalldataHex('deadBEEF')).toBe('0xdeadbeef');
  });

  it('validates to address', () => {
    expect(normalizeToAddress('0x1111111111111111111111111111111111111111')).toMatch(/^0x/i);
    expect(() => normalizeToAddress('not-an-address')).toThrow();
  });

  it('converts eth to wei string', () => {
    expect(ethAmountToWeiString('0')).toBe('0');
    expect(ethAmountToWeiString('1')).toBe('1000000000000000000');
  });

  it('encodes erc20 balanceOf from shipped abi', () => {
    const abi = loadShippedAbi('erc20-minimal');
    expect(abi).toBeTruthy();
    const data = buildCalldataFromAbiForm({
      abiJson: JSON.stringify(abi),
      functionName: 'balanceOf',
      argsJson: '["0x1111111111111111111111111111111111111111"]',
    });
    expect(data.startsWith('0x')).toBe(true);
    expect(data.length).toBeGreaterThan(10);
  });

  it('detects squad infra target addresses', () => {
    const target = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01';
    expect(isSquadInfraTargetAddress(target, [target.toLowerCase()])).toBe(true);
    expect(isSquadInfraTargetAddress('0x0000000000000000000000000000000000000001', [])).toBe(false);
  });
});
