/**
 * Chain and RPC configuration for the embedded wallet.
 * Shared module for read-only chain access (balance, contract reads) via viem.
 */

import { createPublicClient, type Chain, type PublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

/** Supported chains (PoC: Sepolia first; extend for mainnet/L2s later). */
export const SUPPORTED_CHAINS = {
  sepolia,
} as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;

/** Default chain for the PoC (Squad Safe on Sepolia). */
export const DEFAULT_CHAIN_ID: SupportedChainId = 'sepolia';

/** Default RPC URL per chain. Use public RPCs; replace with env or app config for rate limits. */
const DEFAULT_RPC_URLS: Record<SupportedChainId, string> = {
  sepolia: 'https://rpc.sepolia.org',
};

/**
 * Get the chain and RPC URL for the given chain id.
 */
export function getChainConfig(chainId: SupportedChainId = DEFAULT_CHAIN_ID): {
  chain: Chain;
  rpcUrl: string;
} {
  const chain = SUPPORTED_CHAINS[chainId];
  const rpcUrl = DEFAULT_RPC_URLS[chainId];
  return { chain, rpcUrl };
}

/**
 * Create a public (read-only) client for the given chain.
 * Use for getBalance, getTransactionCount, readContract, waitForTransactionReceipt, etc.
 */
export function createWalletPublicClient(
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
  rpcUrl?: string
): PublicClient {
  const { chain, rpcUrl: defaultUrl } = getChainConfig(chainId);
  const url = rpcUrl ?? defaultUrl;
  return createPublicClient({
    chain,
    transport: http(url),
  });
}
