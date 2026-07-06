/**
 * Chain and RPC configuration for the embedded wallet.
 * Shared module for read-only chain access (balance, contract reads) via viem.
 */

import { createPublicClient, type Chain, type PublicClient, fallback, http } from 'viem';
import { anvil as anvilChain, arbitrum, mainnet, sepolia } from 'viem/chains';

/** Anvil local testnet chain from viem/chains (chain id 31337). */

/**
 * Supported chains for the embedded wallet (DM WalletBar + Squad Safe).
 * Token addresses per chain: `wallet-assets.json` and `assets.ts`.
 */
export const SUPPORTED_CHAINS = {
  arbitrum,
  mainnet,
  sepolia,
  local: anvilChain,
} as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;

/** Default chain */
export const DEFAULT_CHAIN_ID: SupportedChainId = 'sepolia';

/** Request timeout for RPC calls (public RPCs can be slow). */
const RPC_TIMEOUT_MS = 20_000;

import { resolveUserRpcUrls } from './rpc-prefs';
import { resolveProviderRpcUrls } from './rpc-providers';

/** Public RPC catalog for Settings default picker (no env or user overrides). */
export { getCuratedRpcUrlsForChain } from './rpc-catalog';

/**
 * Resolved RPC URL list for a chain: operator provider key (e.g. Alchemy) if set,
 * otherwise user default/personal prefs, then curated public defaults.
 */
export function getEffectiveRpcUrlsForChain(chainId: SupportedChainId): string[] {
  const fromProvider = resolveProviderRpcUrls(chainId);
  if (fromProvider.length > 0) return fromProvider;
  return resolveUserRpcUrls(chainId);
}

/**
 * Get the chain and RPC URLs for the given chain id.
 */
export function getChainConfig(chainId: SupportedChainId = DEFAULT_CHAIN_ID): {
  chain: Chain;
  rpcUrls: string[];
} {
  const chain = SUPPORTED_CHAINS[chainId];
  const rpcUrls = getEffectiveRpcUrlsForChain(chainId);
  return { chain, rpcUrls };
}

/**
 * Create a public (read-only) client for the given chain.
 * Uses a single URL with extended timeout, or fallback transports when no URL override is given.
 */
export function createWalletPublicClient(
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
  rpcUrl?: string
): PublicClient {
  const { chain, rpcUrls } = getChainConfig(chainId);
  const httpOpts = { timeout: RPC_TIMEOUT_MS };

  if (rpcUrl) {
    return createPublicClient({
      chain,
      transport: http(rpcUrl, httpOpts),
    });
  }
  const transports = rpcUrls.map((url) => http(url, httpOpts));
  return createPublicClient({
    chain,
    transport: fallback(transports),
  });
}

/** Map stored / announce chain strings to a supported chain id (default Sepolia). */
export function parseSupportedChainId(raw: string | undefined | null): SupportedChainId {
  const c = (raw ?? 'sepolia').trim().toLowerCase();
  if (c === 'mainnet' || c === 'ethereum' || c === 'eth') return 'mainnet';
  if (c === 'arbitrum' || c === 'arb') return 'arbitrum';
  if (c === 'local') return 'local';
  return 'sepolia';
}

/** Block explorer "address" URL for wallet/Safe deep links (opens in system browser). */
export function explorerAddressUrl(chainId: SupportedChainId, address: string): string {
  const raw = SUPPORTED_CHAINS[chainId]?.blockExplorers?.default?.url;
  const base = typeof raw === 'string' ? raw.replace(/\/$/, '') : '';
  if (!base || !address.trim()) return '';
  return `${base}/address/${address.trim()}`;
}

/**
 * Safe{Wallet} web app home URL (`?safe=<shortName>:<address>`).
 * Short prefixes match the query format used on https://app.safe.global
 */
const SAFE_APP_CHAIN_PREFIX: Record<SupportedChainId, string> = {
  arbitrum: 'arb1',
  local: '',
  mainnet: 'eth',
  sepolia: 'sep',
};

const SAFE_APP_ORIGIN = 'https://app.safe.global';

export function safeAppHomeUrl(chainId: SupportedChainId, address: string): string {
  const prefix = SAFE_APP_CHAIN_PREFIX[chainId];
  const raw = address.trim().toLowerCase();
  if (!prefix || !raw) return '';
  const norm = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[a-f0-9]{40}$/.test(norm)) return '';
  return `${SAFE_APP_ORIGIN}/home?safe=${prefix}:${norm}`;
}
