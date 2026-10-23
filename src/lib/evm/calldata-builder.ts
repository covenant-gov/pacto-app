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
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

export function normalizeCalldataHex(raw: string): Hex {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '0x') return '0x';
  const body = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;
  if (body.length % 2 !== 0) throw new Error(get(t)('wallet.errors.calldataOddLength'));
  if (!/^[0-9a-fA-F]+$/.test(body)) throw new Error(get(t)('wallet.errors.calldataNonHex'));
  return `0x${body.toLowerCase()}` as Hex;
}

export function normalizeToAddress(raw: string): Address {
  const trimmed = raw.trim();
  if (!isAddress(trimmed)) throw new Error(get(t)('wallet.errors.invalidContractAddress'));
  return trimmed as Address;
}

/** Decimal ETH string → wei decimal string for Tauri `valueWei`. */
export function ethAmountToWeiString(amountEth: string): string {
  const trimmed = amountEth.trim();
  if (!trimmed || trimmed === '0') return '0';
  return parseEther(trimmed).toString();
}

export function weiStringToEthDisplay(wei: string): string {
  const trimmed = wei.trim();
  if (!trimmed || trimmed === '0') return '0';
  try {
    return formatEther(BigInt(trimmed));
  } catch {
    return trimmed;
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
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) throw new Error(get(t)('wallet.errors.argsNotArray'));
  return parsed;
}

export function buildCalldataFromAbiForm(params: {
  abiJson: string;
  functionName: string;
  argsJson: string;
}): Hex {
  const abi = parseAbiJson(params.abiJson);
  const fn = params.functionName.trim();
  if (!fn) throw new Error(get(t)('wallet.errors.functionNameRequired'));
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
    return { ok: false, message: get(t)('wallet.errors.valueNotWei') };
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
