/**
 * Advanced-purpose contract send (Phase H). Air-gapped from squad/governance paths.
 */

import { invoke } from '@tauri-apps/api/core';
import type { SupportedChainId } from '../wallet/chains';
import { parseWalletOpError, type WalletOpParsedError } from '../wallet/backend-wallet';

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as { __TAURI__?: unknown }).__TAURI__;
}

export interface AdvancedContractCallResult {
  txHash: string;
  network: string;
  chainId: number;
  blockNumber?: string;
}

export type AdvancedSendOutcome =
  | { ok: true; result: AdvancedContractCallResult }
  | { ok: false; message: string; parsed?: WalletOpParsedError };

export async function evmSendAdvancedContractCall(params: {
  network: SupportedChainId;
  to: string;
  valueWei: string;
  dataHex: string;
  waitForConfirmation?: boolean;
}): Promise<AdvancedSendOutcome> {
  if (!isTauri()) {
    return { ok: false, message: 'Advanced sends are only available in the desktop app.' };
  }
  try {
    const result = await invoke<AdvancedContractCallResult>('evm_send_advanced_contract_call', {
      network: params.network,
      to: params.to.trim(),
      valueWei: params.valueWei.trim() || '0',
      dataHex: params.dataHex.trim() || '0x',
      waitForConfirmation: params.waitForConfirmation ?? false,
    });
    return { ok: true, result };
  } catch (e) {
    const raw =
      typeof e === 'string'
        ? e
        : e != null && typeof (e as Error).message === 'string'
          ? (e as Error).message
          : 'Advanced send failed.';
    const parsed = parseWalletOpError(raw);
    return { ok: false, message: parsed?.message ?? raw, parsed: parsed ?? undefined };
  }
}

export async function listSquadInfraCanonicalRefs(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    const rows = await invoke<string[]>('list_squad_infra_canonical_refs');
    return rows ?? [];
  } catch {
    return [];
  }
}
