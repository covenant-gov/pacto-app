/**
 * Chain and RPC configuration for the embedded wallet.
 * Shared module for read-only chain access (balance, contract reads) via viem.
 */

import { createPublicClient, type Chain, type PublicClient, fallback, http } from 'viem';
import { mainnet, optimism, sepolia } from 'viem/chains';

/**
 * Supported chains for the embedded wallet (DM WalletBar + Squad Safe).
 * Token addresses per chain: `wallet-assets.json` and `assets.ts`.
 */
export const SUPPORTED_CHAINS = {
  mainnet,
  optimism,
  sepolia,
} as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;

/** Default chain */
export const DEFAULT_CHAIN_ID: SupportedChainId = 'sepolia';

/** Request timeout for RPC calls (public RPCs can be slow). */
const RPC_TIMEOUT_MS = 20_000;

/**
 * Default RPC URL(s) per chain. First is primary; others used as fallback.
 * Superseded when `VITE_WALLET_RPC_*` is set (see `getEffectiveRpcUrlsForChain`).
 */
const DEFAULT_RPC_URLS: Record<SupportedChainId, string[]> = {
  mainnet: ['https://ethereum.publicnode.com', 'https://1rpc.io/eth'],
  optimism: ['https://mainnet.optimism.io', 'https://optimism.publicnode.com'],
  sepolia: [
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://1rpc.io/sepolia',
    'https://sepolia.drpc.org',
    'https://rpc2.sepolia.org',
    'https://rpc.sepolia.org',
  ],
};

const VITE_RPC_ENV_KEYS: Record<SupportedChainId, keyof ImportMetaEnv> = {
  mainnet: 'VITE_WALLET_RPC_MAINNET',
  optimism: 'VITE_WALLET_RPC_OPTIMISM',
  sepolia: 'VITE_WALLET_RPC_SEPOLIA',
};

function parseCommaSeparatedUrls(value: unknown): string[] | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const parts = s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  return parts.length > 0 ? parts : null;
}

/**
 * Resolved RPC URL list for a chain: `VITE_WALLET_RPC_*` if set (comma-separated),
 * otherwise built-in defaults. Use for viem public clients and for parity with
 * backend RPC configuration described in `docs/wallet/RPC_AND_VIEM_ARCHITECTURE.md`.
 */
export function getEffectiveRpcUrlsForChain(chainId: SupportedChainId): string[] {
  const key = VITE_RPC_ENV_KEYS[chainId];
  const raw = import.meta.env[key];
  const fromEnv = parseCommaSeparatedUrls(raw);
  if (fromEnv) return fromEnv;
  return DEFAULT_RPC_URLS[chainId];
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
  if (c === 'optimism' || c === 'op') return 'optimism';
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
  mainnet: 'eth',
  sepolia: 'sep',
  optimism: 'oeth',
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
