import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_CHAINS,
  createWalletPublicClient,
  explorerAddressUrl,
  getChainConfig,
  parseSupportedChainId,
  safeAppHomeUrl,
} from './chains';

describe('SUPPORTED_CHAINS.local', () => {
  it('is Anvil with chain id 31337', () => {
    expect(SUPPORTED_CHAINS.local.id).toBe(31_337);
    expect(SUPPORTED_CHAINS.local.name).toBe('Anvil');
    expect(SUPPORTED_CHAINS.local.nativeCurrency).toEqual({
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    });
    expect(SUPPORTED_CHAINS.local.rpcUrls.default.http).toEqual(['http://127.0.0.1:8545']);
  });
});

describe('parseSupportedChainId', () => {
  it('recognizes the canonical local key (case-insensitive)', () => {
    expect(parseSupportedChainId('local')).toBe('local');
    expect(parseSupportedChainId('LOCAL')).toBe('local');
    expect(parseSupportedChainId('  local  ')).toBe('local');
  });

  it('falls back to sepolia for unknown values (including the retired anvil alias)', () => {
    expect(parseSupportedChainId('anvil')).toBe('sepolia');
    expect(parseSupportedChainId('hardhat')).toBe('sepolia');
    expect(parseSupportedChainId('')).toBe('sepolia');
    expect(parseSupportedChainId(undefined)).toBe('sepolia');
  });
});

describe('getChainConfig', () => {
  it('returns Anvil chain and curated localhost RPC for local', () => {
    const { chain, rpcUrls } = getChainConfig('local');
    expect(chain.id).toBe(31_337);
    expect(rpcUrls).toContain('http://localhost:8545');
  });
});

describe('createWalletPublicClient', () => {
  it('creates a read client for local Anvil', () => {
    const client = createWalletPublicClient('local');
    expect(client.chain?.id).toBe(31_337);
  });
});

describe('explorerAddressUrl', () => {
  it('returns empty string for local (no explorer configured)', () => {
    expect(explorerAddressUrl('local', '0x1111111111111111111111111111111111111111')).toBe('');
  });
});

describe('safeAppHomeUrl', () => {
  it('returns empty string for local (no Safe short name)', () => {
    expect(safeAppHomeUrl('local', '0x1111111111111111111111111111111111111111')).toBe('');
  });
});
