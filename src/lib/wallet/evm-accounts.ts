/**
 * Tauri: EVM multi-account (derived from recovery phrase + imported). Commands defined in `src-tauri/src/evm/evm_accounts.rs`.
 */

import { invoke } from '@tauri-apps/api/core';

export type EvmAccountPurpose = 'squad' | 'advanced';

export interface EvmAccountRow {
  id: string;
  scheme: string;
  hdIndex: number | null;
  address: string;
  label: string;
  purpose: EvmAccountPurpose;
  isActive: boolean;
  isDefaultShared: boolean;
  isActiveAdvanced: boolean;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as { __TAURI__?: unknown }).__TAURI__;
}

export function isSquadPurposeAccount(row: Pick<EvmAccountRow, 'purpose'>): boolean {
  return row.purpose === 'squad';
}

export function isAdvancedPurposeAccount(row: Pick<EvmAccountRow, 'purpose'>): boolean {
  return row.purpose === 'advanced';
}

export function squadEvmAccounts(rows: EvmAccountRow[] | null | undefined): EvmAccountRow[] {
  return rows?.filter(isSquadPurposeAccount) ?? [];
}

export function advancedEvmAccounts(rows: EvmAccountRow[] | null | undefined): EvmAccountRow[] {
  return rows?.filter(isAdvancedPurposeAccount) ?? [];
}

/** Human-readable scheme for UI (no internal identifiers in user-facing copy beyond these labels). */
export function evmAccountSchemeLabel(scheme: string): string {
  if (scheme === 'bip44_v1') return 'Derived';
  if (scheme === 'imported_private_key') return 'Imported';
  return scheme;
}

export function evmAccountPurposeLabel(purpose: EvmAccountPurpose): string {
  return purpose === 'advanced' ? 'Advanced' : 'Squad';
}

export async function listEvmAccounts(): Promise<EvmAccountRow[] | null> {
  if (!isTauri()) return null;
  return invoke<EvmAccountRow[]>('list_evm_accounts');
}

/** Active squad-purpose signing account `0x` address, if any. */
export async function getActiveSquadEvmSignerAddress(): Promise<string | null> {
  const rows = await listEvmAccounts();
  if (!rows?.length) return null;
  const active = rows.find((r) => r.isActive && isSquadPurposeAccount(r));
  const a = active?.address?.trim();
  return a || null;
}

/** Active advanced-purpose signing account `0x` address, if any. */
export async function getActiveAdvancedEvmSignerAddress(): Promise<string | null> {
  const rows = await listEvmAccounts();
  if (!rows?.length) return null;
  const active = rows.find((r) => r.isActiveAdvanced && isAdvancedPurposeAccount(r));
  const a = active?.address?.trim();
  return a || null;
}

/** @deprecated Prefer getActiveSquadEvmSignerAddress for squad/gov paths. */
export async function getActiveEvmSignerAddress(): Promise<string | null> {
  return getActiveSquadEvmSignerAddress();
}

export async function addEvmAccountRow(params: {
  label: string;
  setActiveSigner: boolean;
  setDefaultShared: boolean;
  purpose?: EvmAccountPurpose;
}): Promise<EvmAccountRow> {
  return invoke<EvmAccountRow>('add_evm_account', {
    label: params.label ?? '',
    setActiveSigner: params.setActiveSigner,
    setDefaultShared: params.setDefaultShared,
    purpose: params.purpose ?? 'squad',
  });
}

export async function importEvmAccountRow(privateKeyHex: string): Promise<EvmAccountRow> {
  return invoke<EvmAccountRow>('import_evm_account', {
    privateKeyHex,
    setActiveSigner: false,
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

export async function setActiveAdvancedEvmAccount(accountId: string): Promise<void> {
  await invoke('set_active_advanced_evm_account', { accountId });
}
