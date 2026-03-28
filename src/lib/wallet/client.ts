/**
 * Read-only viem public client for the wallet (RPC URLs from env / chain config).
 * Account address and signing stay in the Tauri layer.
 */

import {
  createWalletPublicClient,
  DEFAULT_CHAIN_ID,
  type SupportedChainId,
} from '$lib/wallet/chains';

/** Public client for the default (or given) chain. */
export function getPublicClient(chainId: SupportedChainId = DEFAULT_CHAIN_ID) {
  return createWalletPublicClient(chainId);
}
