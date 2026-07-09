/**
 * Generic viem read plane (Phase H). No private keys — observation only.
 * Curated pacto-gov dashboard reads stay in Tauri (`gov_read`, etc.).
 */

import {
  type Abi,
  type AbiStateMutability,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  getContract,
} from 'viem';
import { createWalletPublicClient, type SupportedChainId } from '../wallet/chains';
import { withReadPlaneLimit } from './read-plane-limiter';

export class ReadPlaneError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReadPlaneError';
    this.code = code;
  }
}

function wrapReadError(e: unknown, fallbackCode: string): ReadPlaneError {
  const msg =
    e != null && typeof (e as Error).message === 'string'
      ? (e as Error).message
      : 'Contract read failed.';
  return new ReadPlaneError(fallbackCode, msg);
}

export async function readContract<
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi>,
>(params: {
  chainId: SupportedChainId;
  address: Address;
  abi: TAbi;
  functionName: TFunctionName;
  args?: ContractFunctionArgs<TAbi, AbiStateMutability, TFunctionName>;
}): Promise<unknown> {
  const client = createWalletPublicClient(params.chainId);
  try {
    return await withReadPlaneLimit(() =>
      client.readContract({
        address: params.address,
        abi: params.abi,
        functionName: params.functionName,
        args: params.args,
      }),
    );
  } catch (e) {
    throw wrapReadError(e, 'READ_CONTRACT_FAILED');
  }
}

export async function multicall(params: {
  chainId: SupportedChainId;
  contracts: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }[];
}): Promise<unknown[]> {
  if (!params.contracts.length) return [];
  const client = createWalletPublicClient(params.chainId);
  try {
    return await withReadPlaneLimit(() => client.multicall({ contracts: params.contracts }));
  } catch (e) {
    throw wrapReadError(e, 'MULTICALL_FAILED');
  }
}

/** `eth_call` simulation for Advanced panel preview (from optional `from` address). */
export async function simulateContractCall(params: {
  chainId: SupportedChainId;
  from?: Address;
  to: Address;
  valueWei?: bigint;
  data: `0x${string}`;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const client = createWalletPublicClient(params.chainId);
  try {
    await withReadPlaneLimit(() =>
      client.call({
        account: params.from,
        to: params.to,
        value: params.valueWei ?? 0n,
        data: params.data,
      }),
    );
    return { ok: true as const };
  } catch (e) {
    const msg =
      e != null && typeof (e as Error).message === 'string'
        ? (e as Error).message
        : 'Simulation reverted.';
    return { ok: false, message: msg };
  }
}

/** Convenience wrapper around `getContract` + read for typed module views. */
export function getReadOnlyContract<TAbi extends Abi>(params: {
  chainId: SupportedChainId;
  address: Address;
  abi: TAbi;
}) {
  const client = createWalletPublicClient(params.chainId);
  return getContract({ address: params.address, abi: params.abi, client });
}
