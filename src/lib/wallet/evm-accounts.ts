/**
 * Tauri: EVM multi-account (derived from recovery phrase + imported). Commands defined in `src-tauri/src/evm_accounts.rs`.
 */

import { invoke } from '@tauri-apps/api/core';

export interface EvmAccountRow {
  id: string;
  scheme: string;
  hdIndex: number | null;
  address: string;
  label: string;
  isActive: boolean;
  isDefaultShared: boolean;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as { __TAURI__?: unknown }).__TAURI__;
}

/** Human-readable scheme for UI (no internal identifiers in user-facing copy beyond these labels). */
export function evmAccountSchemeLabel(scheme: string): string {
  if (scheme === 'bip44_v1') return 'Derived';
  if (scheme === 'imported_private_key') return 'Imported';
  return scheme;
}

export async function listEvmAccounts(): Promise<EvmAccountRow[] | null> {
  if (!isTauri()) return null;
  return invoke<EvmAccountRow[]>('list_evm_accounts');
}

/** Active signing account `0x` address, if multi-account state is available. */
export async function getActiveEvmSignerAddress(): Promise<string | null> {
  const rows = await listEvmAccounts();
  if (!rows?.length) return null;
  const active = rows.find((r) => r.isActive);
  const a = active?.address?.trim();
  return a || null;
}

export async function addEvmAccountRow(params: {
  label: string;
  setActiveSigner: boolean;
  setDefaultShared: boolean;
}): Promise<EvmAccountRow> {
  return invoke<EvmAccountRow>('add_evm_account', {
    label: params.label ?? '',
    setActiveSigner: params.setActiveSigner,
    setDefaultShared: params.setDefaultShared,
  });
}

export async function importEvmAccountRow(
  privateKeyHex: string,
  setActiveSigner: boolean
): Promise<EvmAccountRow> {
  return invoke<EvmAccountRow>('import_evm_account', {
    privateKeyHex,
    setActiveSigner,
  });
}

export async function updateEvmAccountRow(params: {
  accountId: string;
  label: string;
  setActiveSigner: boolean;
  setDefaultShared: boolean;
}): Promise<EvmAccountRow> {
  return invoke<EvmAccountRow>('update_evm_account', {
    accountId: params.accountId,
    label: params.label ?? '',
    setActiveSigner: params.setActiveSigner,
    setDefaultShared: params.setDefaultShared,
  });
}

export async function setActiveEvmAccount(accountId: string): Promise<void> {
  await invoke('set_active_evm_account', { accountId });
}

export async function setDefaultSharedEvmAccount(accountId: string): Promise<void> {
  await invoke('set_default_shared_evm_account', { accountId });
}
