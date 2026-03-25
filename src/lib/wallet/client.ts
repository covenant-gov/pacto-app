/**
 * Wallet client and account usage (read-only from frontend).
 * - Address comes from the backend (get_evm_address); the private key never leaves the Tauri process.
 * - Signing: use a Tauri command in the Rust layer so the private key stays in the app process.
 */

import type { Address } from 'viem';
import { getEvmAddress } from '$lib/api/auth';
import {
  createWalletPublicClient,
  DEFAULT_CHAIN_ID,
  type SupportedChainId,
} from '$lib/wallet/chains';

/** Get the current account's EVM address from the backend (no private key exposed). */
export async function getCurrentAddress(): Promise<Address | null> {
  const raw = await getEvmAddress();
  if (!raw || typeof raw !== 'string') return null;
  return raw as Address;
}

/** Public client for the default (or given) chain. Use for balance, contract reads, waitForTransactionReceipt. */
export function getPublicClient(chainId: SupportedChainId = DEFAULT_CHAIN_ID) {
  return createWalletPublicClient(chainId);
}

/**
 * Get native token balance for an address.
 * If address is omitted, uses the current account's address from the backend.
 */
export async function getBalance(
  address?: Address,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID
): Promise<bigint> {
  const client = getPublicClient(chainId);
  const addr = address ?? (await getCurrentAddress());
  if (!addr) return 0n;
  return client.getBalance({ address: addr });
}
