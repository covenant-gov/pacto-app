import { describe, expect, it } from 'vitest';
import {
  WALLET_ASSETS_CHAIN_IDS,
  WALLET_CHAIN_GROUPS,
  WALLET_ASSETS,
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

  it('groups l1, l2, testnet, and local chains', () => {
    const ids = WALLET_CHAIN_GROUPS.map((g) => g.id);
    expect(ids).toContain('l1');
    expect(ids).toContain('l2');
    expect(ids).toContain('testnet');
    expect(ids).toContain('local');
  });

  it('keeps the mainnet group as l1', () => {
    const l1 = WALLET_CHAIN_GROUPS.find((g) => g.id === 'l1');
    expect(l1?.chains).toContain('mainnet');
  });
});

describe('WALLET_ASSETS', () => {
  it('has a native entry for every supported chain', () => {
    for (const chainId of WALLET_ASSETS_CHAIN_IDS) {
      const net = WALLET_ASSETS.networks[chainId];
      expect(net).toBeDefined();
      expect(net?.native.symbol).toBeDefined();
      expect(net?.native.decimals).toBeGreaterThan(0);
    }
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

  it('returns undefined for an unknown chain', () => {
    expect(getWalletAssetsForChain('unknown' as never)).toBeUndefined();
  });
});

describe('getWalletNetworkDisplayName', () => {
  it('returns Local Anvil for the local chain', () => {
    expect(getWalletNetworkDisplayName('local')).toBe('Local Anvil');
  });

  it('returns Arbitrum for the arbitrum chain', () => {
    expect(getWalletNetworkDisplayName('arbitrum')).toBe('Arbitrum');
  });

  it('falls back to the chain id when there is no configured display name', () => {
    expect(getWalletNetworkDisplayName('unknown' as never)).toBe('unknown');
  });
});

describe('getExplorerTxUrl', () => {
  it('returns null for the local chain', () => {
    expect(
      getExplorerTxUrl('local', '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'),
    ).toBeNull();
  });

  it('returns null when the chain has no explorer', () => {
    expect(
      getExplorerTxUrl('unknown' as never, '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'),
    ).toBeNull();
  });

  it('builds a Sepolia Etherscan link', () => {
    const tx = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    expect(getExplorerTxUrl('sepolia', tx)).toBe(`https://sepolia.etherscan.io/tx/${tx}`);
  });

  it('trims a trailing slash from the explorer path', () => {
    const tx = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const assets = getWalletAssetsForChain('mainnet');
    expect(getExplorerTxUrl('mainnet', tx)).toBe(`${assets?.explorerTxPath}${tx}`);
  });
});

describe('explorerTxLinkLabel', () => {
  it('returns the fallback label for the local chain', () => {
    expect(explorerTxLinkLabel('local')).toBe('View on block explorer');
  });

  it('derives the label from the explorer hostname', () => {
    expect(explorerTxLinkLabel('sepolia')).toBe('View on sepolia.etherscan.io');
    expect(explorerTxLinkLabel('mainnet')).toBe('View on etherscan.io');
  });

  it('returns the fallback label when there is no explorer', () => {
    expect(explorerTxLinkLabel('unknown' as never)).toBe('View on block explorer');
  });
});

describe('listWalletAssetOptionsForChain', () => {
  it('includes ETH and excludes zero-address USDC/USDT on local', () => {
    const options = listWalletAssetOptionsForChain('local');
    expect(options.map((o) => o.code)).toEqual(['ETH']);
    expect(
      options.every((o) => o.kind !== 'erc20' || o.address !== '0x0000000000000000000000000000000000000000'),
    ).toBe(true);
  });

  it('includes ETH, USDC, and USDT on Sepolia', () => {
    const options = listWalletAssetOptionsForChain('sepolia');
    expect(options.map((o) => o.code)).toEqual(['ETH', 'USDC', 'USDT']);
    expect(options.every((o) => o.kind !== 'erc20' || o.address !== '0x0000000000000000000000000000000000000000')).toBe(true);
  });

  it('returns only the native option when the chain is unknown', () => {
    const options = listWalletAssetOptionsForChain('unknown' as never);
    expect(options).toEqual([]);
  });
});
