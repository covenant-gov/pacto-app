/**
 * Advanced write calldata helpers (Phase H): manual hex or viem encodeFunctionData.
 */

import {
  type Abi,
  type Address,
  encodeFunctionData,
  formatEther,
  isAddress,
  parseEther,
  type Hex,
} from 'viem';
import { parseAbiJson } from './abi-loader';
import { simulateContractCall } from './read-plane';
import type { SupportedChainId } from '../wallet/chains';

export function normalizeCalldataHex(raw: string): Hex {
  const t = raw.trim();
  if (!t || t === '0x') return '0x';
  const body = t.startsWith('0x') || t.startsWith('0X') ? t.slice(2) : t;
  if (body.length % 2 !== 0) throw new Error('Calldata hex must have an even number of digits.');
  if (!/^[0-9a-fA-F]+$/.test(body)) throw new Error('Calldata contains non-hex characters.');
  return `0x${body.toLowerCase()}` as Hex;
}

export function normalizeToAddress(raw: string): Address {
  const t = raw.trim();
  if (!isAddress(t)) throw new Error('Enter a valid 0x contract address.');
  return t as Address;
}

/** Decimal ETH string → wei decimal string for Tauri `valueWei`. */
export function ethAmountToWeiString(amountEth: string): string {
  const t = amountEth.trim();
  if (!t || t === '0') return '0';
  return parseEther(t).toString();
}

export function weiStringToEthDisplay(wei: string): string {
  const t = wei.trim();
  if (!t || t === '0') return '0';
  try {
    return formatEther(BigInt(t));
  } catch {
    return t;
  }
}

export function encodeFunctionCalldata(params: {
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}): Hex {
  return encodeFunctionData({
    abi: params.abi,
    functionName: params.functionName,
    args: params.args,
  });
}

/** Parse JSON args array for ABI encode mode. */
export function parseAbiArgsJson(raw: string): readonly unknown[] {
  const t = raw.trim();
  if (!t) return [];
  const parsed = JSON.parse(t) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Function args must be a JSON array.');
  return parsed;
}

export function buildCalldataFromAbiForm(params: {
  abiJson: string;
  functionName: string;
  argsJson: string;
}): Hex {
  const abi = parseAbiJson(params.abiJson);
  const fn = params.functionName.trim();
  if (!fn) throw new Error('Function name is required.');
  const args = parseAbiArgsJson(params.argsJson);
  return encodeFunctionCalldata({ abi, functionName: fn, args });
}

export async function simulateAdvancedTransaction(params: {
  chainId: SupportedChainId;
  from?: Address;
  to: Address;
  valueWei: string;
  dataHex: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const data = normalizeCalldataHex(params.dataHex);
  const valueWei = params.valueWei.trim() || '0';
  let value: bigint;
  try {
    value = BigInt(valueWei);
  } catch {
    return { ok: false, message: 'Value must be a decimal wei string.' };
  }
  return simulateContractCall({
    chainId: params.chainId,
    from: params.from,
    to: params.to,
    valueWei: value,
    data,
  });
}

export function isSquadInfraTargetAddress(to: string, canonicalRefs: string[]): boolean {
  const norm = to.trim().toLowerCase();
  if (!norm.startsWith('0x')) return false;
  return canonicalRefs.some((r) => r.trim().toLowerCase() === norm);
}
