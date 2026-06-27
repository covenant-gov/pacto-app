/**
 * Squad contract allowlist (Phase I): persistence, announce sync, allowlisted squad-key sends.
 */

import { invoke } from '@tauri-apps/api/core';
import { sendDmMessage } from '../api/nostr';
import type { SupportedChainId } from '../wallet/chains';
import { parseWalletOpError, type WalletOpParsedError } from '../wallet/backend-wallet';

export const SQUAD_CONTRACT_ALLOWLIST_ANNOUNCE_TYPE = 'squad_contract_allowlist_updated';

export interface SquadContractAllowlistRow {
  id: string;
  parentId: string;
  chain: string;
  contractAddress: string;
  label: string;
  addedByNpub: string;
  abiRef?: string | null;
  notes?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SquadAllowlistAnnouncePayload {
  parent_id: string;
  entry_id: string;
  action: 'upsert' | 'remove';
  chain?: string;
  contract_address?: string;
  label?: string;
  added_by_npub?: string;
  abi_ref?: string | null;
  notes?: string | null;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as { __TAURI__?: unknown }).__TAURI__;
}

export function squadAllowlistEntryId(
  parentId: string,
  chain: string,
  contractAddress: string,
): string {
  return `allowlist-${parentId.trim()}-${chain.trim().toLowerCase()}-${contractAddress.trim().toLowerCase()}`;
}

export async function listSquadContractAllowlist(parentId: string): Promise<SquadContractAllowlistRow[]> {
  if (!isTauri() || !parentId.trim()) return [];
  const rows = await invoke<SquadContractAllowlistRow[]>('list_squad_contract_allowlist', {
    parentId: parentId.trim(),
  });
  return rows ?? [];
}

export async function upsertSquadContractAllowlist(params: {
  parentId: string;
  chain: string;
  contractAddress: string;
  label: string;
  abiRef?: string | null;
  notes?: string | null;
}): Promise<SquadContractAllowlistRow> {
  return invoke<SquadContractAllowlistRow>('upsert_squad_contract_allowlist', {
    parentId: params.parentId.trim(),
    chain: params.chain.trim(),
    contractAddress: params.contractAddress.trim(),
    label: params.label ?? '',
    abiRef: params.abiRef?.trim() ? params.abiRef.trim() : null,
    notes: params.notes?.trim() ? params.notes.trim() : null,
  });
}

export async function removeSquadContractAllowlist(parentId: string, id: string): Promise<void> {
  await invoke('remove_squad_contract_allowlist', {
    parentId: parentId.trim(),
    id: id.trim(),
  });
}

export function buildAllowlistAnnouncePayload(params: {
  parentId: string;
  action: 'upsert' | 'remove';
  row: SquadContractAllowlistRow;
}): SquadAllowlistAnnouncePayload {
  if (params.action === 'remove') {
    return {
      parent_id: params.parentId.trim(),
      entry_id: params.row.id,
      action: 'remove',
    };
  }
  return {
    parent_id: params.row.parentId,
    entry_id: params.row.id,
    action: 'upsert',
    chain: params.row.chain,
    contract_address: params.row.contractAddress,
    label: params.row.label,
    added_by_npub: params.row.addedByNpub,
    abi_ref: params.row.abiRef ?? null,
    notes: params.row.notes ?? null,
  };
}

export function formatAllowlistAnnounceMessage(payload: SquadAllowlistAnnouncePayload): string {
  return JSON.stringify({
    pacto_virtual_bucket: 'inbox',
    type: SQUAD_CONTRACT_ALLOWLIST_ANNOUNCE_TYPE,
    payload,
  });
}

export async function publishSquadAllowlistAnnounce(
  announcementsGroupId: string,
  payload: SquadAllowlistAnnouncePayload,
): Promise<void> {
  const gid = announcementsGroupId.trim();
  if (!gid) return;
  await sendDmMessage(gid, formatAllowlistAnnounceMessage(payload), '', { virtualBucket: 'inbox' });
}

export interface SquadAllowlistedCallResult {
  txHash: string;
  network: string;
  chainId: number;
  blockNumber?: string;
}

export type SquadAllowlistedSendOutcome =
  | { ok: true; result: SquadAllowlistedCallResult }
  | { ok: false; message: string; parsed?: WalletOpParsedError };

export async function evmSendSquadAllowlistedContractCall(params: {
  parentId: string;
  network: SupportedChainId;
  to: string;
  valueWei: string;
  dataHex: string;
  waitForConfirmation?: boolean;
}): Promise<SquadAllowlistedSendOutcome> {
  if (!isTauri()) {
    return { ok: false, message: 'Squad allowlisted sends are only available in the desktop app.' };
  }
  try {
    const result = await invoke<SquadAllowlistedCallResult>('evm_send_squad_allowlisted_contract_call', {
      parentId: params.parentId.trim(),
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
          : 'Squad allowlisted send failed.';
    const parsed = parseWalletOpError(raw);
    return { ok: false, message: parsed?.message ?? raw, parsed: parsed ?? undefined };
  }
}

export function findAllowlistLabel(
  rows: SquadContractAllowlistRow[],
  chain: string,
  toAddress: string,
): string | null {
  const c = chain.trim().toLowerCase();
  const t = toAddress.trim().toLowerCase();
  const row = rows.find(
    (r) => r.chain.trim().toLowerCase() === c && r.contractAddress.trim().toLowerCase() === t,
  );
  return row?.label?.trim() || null;
}
