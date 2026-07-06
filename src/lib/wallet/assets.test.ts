import { describe, expect, it } from 'vitest';
import {
  WALLET_ASSETS_CHAIN_IDS,
  WALLET_CHAIN_GROUPS,
  getWalletAssetsForChain,
  getWalletNetworkDisplayName,
  getExplorerTxUrl,
  explorerTxLinkLabel,
  listWalletAssetOptionsForChain,
} from './assets';

describe('WALLET_ASSETS_CHAIN_IDS', () => {
  it('is exactly the trimmed set in canonical order', () => {
    expect(WALLET_ASSETS_CHAIN_IDS).toEqual(['mainnet', 'arbitrum', 'sepolia', 'local']);
  });

  it('excludes the removed Optimism and Gnosis chains', () => {
    expect(WALLET_ASSETS_CHAIN_IDS).not.toContain('optimism');
    expect(WALLET_ASSETS_CHAIN_IDS).not.toContain('gnosis');
  });

  it('includes local in the last position', () => {
    expect(WALLET_ASSETS_CHAIN_IDS.at(-1)).toBe('local');
    expect(WALLET_ASSETS_CHAIN_IDS).toContain('local');
  });
});

describe('WALLET_CHAIN_GROUPS', () => {
  it('has a local group containing only the local chain', () => {
    const localGroup = WALLET_CHAIN_GROUPS.find((g) => g.id === 'local');
    expect(localGroup).toBeDefined();
    expect(localGroup?.chains).toEqual(['local']);
  });
});

describe('getWalletAssetsForChain', () => {
  it('returns the Local Anvil asset configuration', () => {
    const assets = getWalletAssetsForChain('local');
    expect(assets).toBeDefined();
    expect(assets?.displayName).toBe('Local Anvil');
    expect(assets?.viemChainKey).toBe('local');
    expect(assets?.explorerTxPath).toBe('');
    expect(assets?.native).toEqual({ symbol: 'ETH', decimals: 18 });
    expect(assets?.tokens.USDC).toEqual({
      address: '0x0000000000000000000000000000000000000000',
      decimals: 6,
      note: 'Zero-address placeholder; not selectable for transfers. Deploy a local USDC mock to test transfers.',
    });
    expect(assets?.tokens.USDT).toEqual({
      address: '0x0000000000000000000000000000000000000000',
      decimals: 6,
      note: 'Zero-address placeholder; not selectable for transfers. Deploy a local USDT mock to test transfers.',
    });
  });
});

describe('getWalletNetworkDisplayName', () => {
  it('returns Local Anvil for the local chain', () => {
    expect(getWalletNetworkDisplayName('local')).toBe('Local Anvil');
  });
});
describe('getExplorerTxUrl', () => {
  it('returns null for the local chain', () => {
    expect(getExplorerTxUrl('local', '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789')).toBeNull();
  });
});

describe('explorerTxLinkLabel', () => {
  it('returns the fallback label for the local chain', () => {
    expect(explorerTxLinkLabel('local')).toBe('View on block explorer');
  });
});

describe('listWalletAssetOptionsForChain', () => {
  it('includes ETH and excludes zero-address USDC/USDT on local', () => {
    const options = listWalletAssetOptionsForChain('local');
    expect(options.map((o) => o.code)).toEqual(['ETH']);
    expect(options.every((o) => o.kind !== 'erc20' || o.address !== '0x0000000000000000000000000000000000000000')).toBe(true);
  });
});
