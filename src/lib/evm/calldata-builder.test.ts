import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildCalldataFromAbiForm,
  ethAmountToWeiString,
  isSquadInfraTargetAddress,
  normalizeCalldataHex,
  normalizeToAddress,
  parseAbiArgsJson,
  simulateAdvancedTransaction,
  weiStringToEthDisplay,
} from './calldata-builder';
import { loadShippedAbi } from './abi-loader';

vi.mock('./read-plane', () => ({
  simulateContractCall: vi.fn(),
}));

import { simulateContractCall } from './read-plane';

describe('calldata-builder', () => {
  beforeEach(() => {
    vi.mocked(simulateContractCall).mockReset();
  });

  it('normalizes calldata hex', () => {
    expect(normalizeCalldataHex('')).toBe('0x');
    expect(normalizeCalldataHex('0x')).toBe('0x');
    expect(normalizeCalldataHex('deadBEEF')).toBe('0xdeadbeef');
  });

  it('rejects calldata with odd length or non-hex characters', () => {
    expect(() => normalizeCalldataHex('abc')).toThrow('even number of digits');
    expect(() => normalizeCalldataHex('0xzz')).toThrow('non-hex characters');
  });

  it('validates to address', () => {
    expect(normalizeToAddress('0x1111111111111111111111111111111111111111')).toMatch(/^0x/i);
    expect(() => normalizeToAddress('not-an-address')).toThrow('Enter a valid 0x contract address');
  });

  it('converts eth to wei string', () => {
    expect(ethAmountToWeiString('0')).toBe('0');
    expect(ethAmountToWeiString('1')).toBe('1000000000000000000');
    expect(ethAmountToWeiString('0.5')).toBe('500000000000000000');
  });

  it('converts wei to eth display', () => {
    expect(weiStringToEthDisplay('0')).toBe('0');
    expect(weiStringToEthDisplay('1000000000000000000')).toBe('1');
  });

  it('returns the raw input when wei cannot be parsed', () => {
    expect(weiStringToEthDisplay('not-a-number')).toBe('not-a-number');
  });

  it('parses ABI args JSON', () => {
    expect(parseAbiArgsJson('')).toEqual([]);
    expect(parseAbiArgsJson('["a", 1]')).toEqual(['a', 1]);
  });

  it('throws when args JSON is not an array', () => {
    expect(() => parseAbiArgsJson('{"a":1}')).toThrow('JSON array');
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
    expect(isSquadInfraTargetAddress('not-an-address', ['0xabc'])).toBe(false);
  });

  it('simulates an advanced transaction with normalized inputs', async () => {
    vi.mocked(simulateContractCall).mockResolvedValue({ ok: true });
    const result = await simulateAdvancedTransaction({
      chainId: 'sepolia',
      to: '0x1111111111111111111111111111111111111111',
      valueWei: '1000',
      dataHex: 'deadbeef',
    });
    expect(result).toEqual({ ok: true });
    expect(simulateContractCall).toHaveBeenCalledWith({
      chainId: 'sepolia',
      to: '0x1111111111111111111111111111111111111111',
      valueWei: 1000n,
      data: '0xdeadbeef',
    });
  });

  it('rejects an invalid wei value', async () => {
    const result = await simulateAdvancedTransaction({
      chainId: 'sepolia',
      to: '0x1111111111111111111111111111111111111111',
      valueWei: 'not-a-number',
      dataHex: '0x',
    });
    expect(result).toEqual({ ok: false, message: 'Value must be a decimal wei string.' });
  });

  it('rejects malformed calldata', async () => {
    await expect(
      simulateAdvancedTransaction({
        chainId: 'sepolia',
        to: '0x1111111111111111111111111111111111111111',
        valueWei: '0',
        dataHex: 'zzzz',
      }),
    ).rejects.toThrow('non-hex characters');
  });
});
