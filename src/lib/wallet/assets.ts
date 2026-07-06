/**
 * Canonical token table for DM WalletBar transfers.
 * Source of truth: `wallet-assets.json`. The Tauri backend embeds the same file at compile time
 * (`src-tauri/src/wallet_chain_config.rs`); edit addresses/decimals/explorer paths here only.
 */

import type { Address } from 'viem';
import type { SupportedChainId } from './chains';

import walletAssetsJson from './wallet-assets.json';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
export type WalletStablecoin = 'USDC' | 'USDT';

export type WalletAssetCode = 'ETH' | WalletStablecoin;

export interface WalletNativeConfig {
  symbol: 'ETH';
  decimals: number;
}

export interface WalletErc20Config {
  address: Address;
  decimals: number;
  note?: string;
}

export interface WalletNetworkAssets {
  viemChainKey: string;
  displayName: string;
  explorerTxPath: string;
  native: WalletNativeConfig;
  tokens: Record<WalletStablecoin, WalletErc20Config>;
}

export interface WalletAssetsFile {
  version: number;
  networks: Record<SupportedChainId, WalletNetworkAssets>;
}

export const WALLET_ASSETS = walletAssetsJson as WalletAssetsFile;

const CHAIN_KEYS = [
  'mainnet',
  'arbitrum',
  'sepolia',
  'local',
] as const satisfies readonly SupportedChainId[];

/** Chains that have a row in wallet-assets.json (must match SupportedChainId). */
export const WALLET_ASSETS_CHAIN_IDS: readonly SupportedChainId[] = CHAIN_KEYS;

export type WalletChainGroupId = 'l1' | 'l2' | 'testnet' | 'local';

/** Enabled-chains UI grouping (L1 / L2 / testnet / local). */
export const WALLET_CHAIN_GROUPS: ReadonlyArray<{
  id: WalletChainGroupId;
  label: string;
  chains: readonly SupportedChainId[];
}> = [
  { id: 'l1', label: 'L1', chains: ['mainnet'] },
  { id: 'l2', label: 'L2', chains: ['arbitrum'] },
  { id: 'testnet', label: 'Testnet', chains: ['sepolia'] },
  { id: 'local', label: 'Local', chains: ['local'] },
];

export function getWalletAssetsForChain(chainId: SupportedChainId): WalletNetworkAssets | undefined {
  return WALLET_ASSETS.networks[chainId];
}

/** Human-readable network label for announcements / UI. */
export function getWalletNetworkDisplayName(chainId: SupportedChainId): string {
  return WALLET_ASSETS.networks[chainId]?.displayName ?? chainId;
}

export function getExplorerTxUrl(chainId: SupportedChainId, txHash: string): string | null {
  const base = WALLET_ASSETS.networks[chainId]?.explorerTxPath;
  if (!base) return null;
  const h = txHash.startsWith('0x') ? txHash : `0x${txHash}`;
  return `${base}${h}`;
}

/** User-facing explorer link label derived from configured `explorerTxPath` hostname (e.g. sepolia.etherscan.io). */
export function explorerTxLinkLabel(chainId: SupportedChainId): string {
  const path = WALLET_ASSETS.networks[chainId]?.explorerTxPath;
  if (!path) return 'View on block explorer';
  try {
    const host = new URL(path).hostname.replace(/^www\./, '');
    return `View on ${host}`;
  } catch {
    return 'View on block explorer';
  }
}

export function listWalletAssetOptionsForChain(chainId: SupportedChainId): {
  code: WalletAssetCode;
  kind: 'native' | 'erc20';
  address?: Address;
  decimals: number;
}[] {
  const net = WALLET_ASSETS.networks[chainId];
  if (!net) return [];
  const out: {
    code: WalletAssetCode;
    kind: 'native' | 'erc20';
    address?: Address;
    decimals: number;
  }[] = [
    {
      code: 'ETH',
      kind: 'native',
      decimals: net.native.decimals,
    },
  ];
  for (const sym of ['USDC', 'USDT'] as const) {
    const t = net.tokens[sym];
    if ((t.address as string).toLowerCase() === ZERO_ADDRESS) continue;
    out.push({
      code: sym,
      kind: 'erc20',
      address: t.address as Address,
      decimals: t.decimals,
    });
  }
  return out;
}
