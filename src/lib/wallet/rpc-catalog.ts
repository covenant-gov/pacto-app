import { WALLET_ASSETS_CHAIN_IDS } from './assets';

type SupportedChainId = (typeof WALLET_ASSETS_CHAIN_IDS)[number];

/**
 * Curated public RPC URL(s) per chain. First is primary; others used as fallback.
 */
export const CURATED_RPC_URLS: Record<SupportedChainId, string[]> = {
  arbitrum: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.publicnode.com'],
  gnosis: ['https://rpc.gnosischain.com', 'https://gnosis.publicnode.com'],
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

export function getCuratedRpcUrlsForChain(chainId: SupportedChainId): string[] {
  return [...CURATED_RPC_URLS[chainId]];
}
