/**
 * Read Safe (Gnosis Safe) state via viem: owners, threshold, nonce, balance.
 * Used by the dashboard / Treasury view for squad and network Safes.
 * 
 * Todo: get full ABI from Safe contracts.
 */

import type { Address } from 'viem';
import { formatEther } from 'viem';
import { getPublicClient } from '$lib/wallet/client';
import { DEFAULT_CHAIN_ID, type SupportedChainId } from '$lib/wallet/chains';

/** Minimal ABI for Safe read-only calls (getOwners, getThreshold, nonce). */
const SAFE_READ_ABI = [
  {
    inputs: [],
    name: 'getOwners',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getThreshold',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'nonce',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export interface SafeState {
  address: Address;
  owners: Address[];
  threshold: number;
  nonce: bigint;
  balanceWei: bigint;
  balanceFormatted: string;
}

/**
 * Read Safe state from chain: owners, threshold, nonce, and native balance.
 * Uses the default chain (Sepolia for PoC). Fails if the address is not a contract or not a Safe.
 */
export async function getSafeState(
  safeAddress: Address,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID
): Promise<SafeState> {
  const client = getPublicClient(chainId);

  const [owners, threshold, nonce, balanceWei] = await Promise.all([
    client.readContract({
      address: safeAddress,
      abi: SAFE_READ_ABI,
      functionName: 'getOwners',
    }),
    client.readContract({
      address: safeAddress,
      abi: SAFE_READ_ABI,
      functionName: 'getThreshold',
    }),
    client.readContract({
      address: safeAddress,
      abi: SAFE_READ_ABI,
      functionName: 'nonce',
    }),
    client.getBalance({ address: safeAddress }),
  ]);

  return {
    address: safeAddress,
    owners: owners as Address[],
    threshold: Number(threshold),
    nonce,
    balanceWei,
    balanceFormatted: formatEther(balanceWei),
  };
}
