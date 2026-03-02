/**
 * Chain and RPC configuration for the embedded wallet.
 * Shared module for read-only chain access (balance, contract reads) via viem.
 */

import { createPublicClient, type Chain, type PublicClient, fallback, http } from 'viem';
import { sepolia } from 'viem/chains';

/** Supported chains (PoC: Sepolia first; extend for mainnet/L2s later). */
export const SUPPORTED_CHAINS = {
  sepolia,
} as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;

/** Default chain for the PoC (Squad Safe on Sepolia). */
export const DEFAULT_CHAIN_ID: SupportedChainId = 'sepolia';

/** Request timeout for RPC calls (public RPCs can be slow). */
const RPC_TIMEOUT_MS = 20_000;

/** Default RPC URL(s) per chain. First is primary; others used as fallback. */
const DEFAULT_RPC_URLS: Record<SupportedChainId, string[]> = {
  sepolia: [
    'https://rpc.sepolia.org',
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://rpc2.sepolia.org',
  ],
};

/**
 * Get the chain and RPC URLs for the given chain id.
 */
export function getChainConfig(chainId: SupportedChainId = DEFAULT_CHAIN_ID): {
  chain: Chain;
  rpcUrls: string[];
} {
  const chain = SUPPORTED_CHAINS[chainId];
  const rpcUrls = DEFAULT_RPC_URLS[chainId];
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
