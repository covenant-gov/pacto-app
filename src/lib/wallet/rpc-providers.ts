/**
 * Operator RPC providers: one API key → per-chain URLs.
 * Keep host map aligned with `src-tauri/src/evm/wallet_rpc_providers.rs`.
 */

import type { SupportedChainId } from './chains';
import { getCuratedRpcUrlsForChain } from './rpc-catalog';

export type RpcProviderId = 'alchemy';

type RpcProviderDef = {
  id: RpcProviderId;
  /** Process env name (also exposed to Vite via `envPrefix` in `vite.config.ts`). */
  keyEnvVar: string;
  hosts: Partial<Record<SupportedChainId, string>>;
};

/** Alchemy network subdomains: `https://{host}.g.alchemy.com/v2/{key}` */
const ALCHEMY_PROVIDER: RpcProviderDef = {
  id: 'alchemy',
  keyEnvVar: 'ALCHEMY_RPC_KEY',
  hosts: {
    mainnet: 'eth-mainnet',
    sepolia: 'eth-sepolia',
    arbitrum: 'arb-mainnet',
  },
};

/** Ordered list — first provider with a configured key wins for primary URL. */
export const RPC_PROVIDERS: readonly RpcProviderDef[] = [ALCHEMY_PROVIDER];

function readEnv(key: string): string | null {
  const raw = import.meta.env[key as keyof ImportMetaEnv];
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildAlchemyRpcUrl(chainId: SupportedChainId, apiKey: string): string | null {
  const host = ALCHEMY_PROVIDER.hosts[chainId];
  if (!host || !apiKey.trim()) return null;
  return `https://${host}.g.alchemy.com/v2/${apiKey.trim()}`;
}

/** Primary RPC URL from operator provider keys (null if unset). */
export function resolveProviderPrimaryRpcUrl(chainId: SupportedChainId): string | null {
  for (const provider of RPC_PROVIDERS) {
    const apiKey = readEnv(provider.keyEnvVar);
    if (!apiKey) continue;
    const host = provider.hosts[chainId];
    if (!host) continue;
    if (provider.id === 'alchemy') {
      return buildAlchemyRpcUrl(chainId, apiKey);
    }
  }
  return null;
}

/** Provider primary + curated public fallbacks (deduped). */
export function resolveProviderRpcUrls(chainId: SupportedChainId): string[] {
  const primary = resolveProviderPrimaryRpcUrl(chainId);
  if (!primary) return [];
  const curated = getCuratedRpcUrlsForChain(chainId);
  const seen = new Set<string>([primary]);
  const out = [primary];
  for (const url of curated) {
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/** Ethereum mainnet URL for Chainlink price reads. */
export function resolveMainnetProviderRpcUrl(): string | null {
  return resolveProviderPrimaryRpcUrl('mainnet');
}
