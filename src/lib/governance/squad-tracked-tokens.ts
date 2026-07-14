/**
 * Squad-tracked ERC-20s for Treasury Safe balance reads (local DB + MLS announce sync).
 */

import { invoke } from '@tauri-apps/api/core';
import { sendDmMessage } from '../api/nostr';

export const SQUAD_TRACKED_TOKENS_ANNOUNCE_TYPE = 'squad_tracked_tokens_updated';

export interface SquadTrackedTokenRow {
  id: string;
  parentId: string;
  chain: string;
  tokenAddress: string;
  symbol: string;
  decimals: number;
  addedByNpub: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SquadTrackedTokenAnnouncePayload {
  parent_id: string;
  entry_id: string;
  action: 'upsert' | 'remove';
  chain?: string;
  token_address?: string;
  symbol?: string;
  decimals?: number;
  added_by_npub?: string;
}

export interface EvmErc20Balance {
  balanceRaw: string;
  balanceDecimal: string;
  symbol: string;
  decimals: number;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as { __TAURI__?: unknown }).__TAURI__;
}

export function squadTrackedTokenEntryId(
  parentId: string,
  chain: string,
  tokenAddress: string,
): string {
  return `tracked-${parentId.trim()}-${chain.trim().toLowerCase()}-${tokenAddress.trim().toLowerCase()}`;
}

export async function listSquadTrackedTokens(parentId: string): Promise<SquadTrackedTokenRow[]> {
  if (!isTauri() || !parentId.trim()) return [];
  const rows = await invoke<SquadTrackedTokenRow[]>('list_squad_tracked_tokens', {
    parentId: parentId.trim(),
  });
  return rows ?? [];
}

export async function upsertSquadTrackedToken(params: {
  parentId: string;
  chain: string;
  tokenAddress: string;
  symbol: string;
  decimals: number;
}): Promise<SquadTrackedTokenRow> {
  return invoke<SquadTrackedTokenRow>('upsert_squad_tracked_token', {
    parentId: params.parentId.trim(),
    chain: params.chain.trim(),
    tokenAddress: params.tokenAddress.trim(),
    symbol: params.symbol.trim(),
    decimals: params.decimals,
  });
}

export async function removeSquadTrackedToken(parentId: string, id: string): Promise<void> {
  await invoke('remove_squad_tracked_token', {
    parentId: parentId.trim(),
    id: id.trim(),
  });
}

export async function getEvmErc20Balance(
  network: string,
  tokenAddress: string,
  ownerAddress: string,
): Promise<{ ok: true; balance: EvmErc20Balance } | { ok: false; message: string }> {
  if (!isTauri()) {
    return { ok: false, message: 'Balances are only available in the desktop app.' };
  }
  const token = tokenAddress.trim();
  const owner = ownerAddress.trim();
  if (!token || !owner) {
    return { ok: false, message: 'Token and owner addresses are required.' };
  }
  try {
    const balance = await invoke<EvmErc20Balance>('get_evm_erc20_balance', {
      network: network.trim(),
      tokenAddress: token,
      ownerAddress: owner,
    });
    return { ok: true, balance };
  } catch (e) {
    const msg =
      typeof e === 'string'
        ? e
        : e != null && typeof (e as Error).message === 'string'
          ? (e as Error).message
          : 'Could not load ERC-20 balance.';
    return { ok: false, message: msg };
  }
}

export function buildTrackedTokenAnnouncePayload(params: {
  parentId: string;
  action: 'upsert' | 'remove';
  row: SquadTrackedTokenRow;
}): SquadTrackedTokenAnnouncePayload {
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
    token_address: params.row.tokenAddress,
    symbol: params.row.symbol,
    decimals: params.row.decimals,
    added_by_npub: params.row.addedByNpub,
  };
}

export function formatTrackedTokenAnnounceMessage(payload: SquadTrackedTokenAnnouncePayload): string {
  return JSON.stringify({
    pacto_virtual_bucket: 'inbox',
    type: SQUAD_TRACKED_TOKENS_ANNOUNCE_TYPE,
    payload,
  });
}

export async function publishSquadTrackedTokenAnnounce(
  announcementsGroupId: string,
  payload: SquadTrackedTokenAnnouncePayload,
): Promise<void> {
  const gid = announcementsGroupId.trim();
  if (!gid) return;
  await sendDmMessage(gid, formatTrackedTokenAnnounceMessage(payload), '', { virtualBucket: 'inbox' });
}
