/**
 * Aztec wallet commands via Tauri backend
 */

import { invoke } from '@tauri-apps/api/core';

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as { __TAURI__?: unknown }).__TAURI__;
}

// ============================================
// TYPES
// ============================================

export interface AztecAccountInfo {
  aztecAddress: string;
  evmAddress: string;
  partialAddress: string;
  publicKeys: {
    npkM: string;
    ivpkM: string;
  };
  isDeployed: boolean;
}

export interface AztecWalletSummary {
  address: string;
  isDeployed: boolean;
  ethBalance: string;
  tokenBalances: AztecTokenBalance[];
}

export interface AztecTokenBalance {
  symbol: string;
  address: string;
  balance: string;
  balanceDecimal: string;
}

export interface AztecTransferRequest {
  toAddress: string;
  amount: string;
  asset: string;
  memo?: string;
}

export interface AztecTransferResult {
  txHash: string;
  blockNumber?: string;
}

export interface SidecarInfo {
  url: string;
  port: number;
  authToken: string;
}

export interface SidecarHealth {
  status: string;
  uptime: number;
  ready: boolean;
}

// ============================================
// SIDEAR CONTROL
// ============================================

export async function startAztecSidecar(port?: number): Promise<SidecarInfo> {
  if (!isTauri()) throw new Error('Tauri required');
  return invoke<SidecarInfo>('aztec_start_sidecar', { port });
}

export async function stopAztecSidecar(): Promise<void> {
  if (!isTauri()) throw new Error('Tauri required');
  return invoke('aztec_stop_sidecar');
}

export async function getAztecSidecarHealth(): Promise<SidecarHealth> {
  if (!isTauri()) throw new Error('Tauri required');
  return invoke<SidecarHealth>('aztec_sidecar_health');
}

export async function getAztecSidecarInfo(): Promise<SidecarInfo> {
  if (!isTauri()) throw new Error('Tauri required');
  return invoke<SidecarInfo>('aztec_sidecar_info');
}

export async function getAztecDebugInfo(): Promise<{
  is_running: boolean;
  stored_port: number;
  stored_url: string;
  stored_token_prefix: string;
  health_check_result: string;
}> {
  if (!isTauri()) throw new Error('Tauri required');
  return invoke('aztec_debug_info');
}

// ============================================
// NODE CONNECTION
// ============================================

export async function connectAztecNode(): Promise<unknown> {
  if (!isTauri()) throw new Error('Tauri required');
  return invoke('aztec_connect_node');
}

export async function getAztecNodeInfo(): Promise<unknown> {
  if (!isTauri()) throw new Error('Tauri required');
  return invoke('aztec_get_node_info');
}

// ============================================
// ACCOUNTS
// ============================================

export type CreateAccountResult =
  | { ok: true; account: AztecAccountInfo }
  | { ok: false; message: string };

export async function createAztecAccountFromEvm(evmPrivateKeyHex?: string): Promise<CreateAccountResult> {
  if (!isTauri()) return { ok: false, message: 'Tauri required' };
  try {
    const account = await invoke<AztecAccountInfo>('aztec_create_account_from_evm', {
      evmPrivateKeyHex: evmPrivateKeyHex || '',
    });
    return { ok: true, account };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

export async function getAztecAccount(): Promise<AztecAccountInfo | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<AztecAccountInfo | null>('aztec_get_account');
  } catch {
    return null;
  }
}

export async function getAztecTestAccounts(): Promise<unknown[]> {
  if (!isTauri()) throw new Error('Tauri required');
  return invoke('aztec_get_test_accounts');
}

// ============================================
// BALANCE
// ============================================

export type BalanceResult =
  | { ok: true; balance: string }
  | { ok: false; message: string };

export async function getAztecBalance(
  aztecAddress: string,
  asset?: string
): Promise<BalanceResult> {
  if (!isTauri()) return { ok: false, message: 'Tauri required' };
  try {
    const balance = await invoke<string>('aztec_get_balance', {
      aztecAddress,
      asset,
    });
    return { ok: true, balance };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

// ============================================
// TRANSFERS
// ============================================

export type TransferResult =
  | { ok: true; result: AztecTransferResult }
  | { ok: false; message: string };

export async function sendAztecTransfer(
  toAddress: string,
  amount: string,
  asset?: string
): Promise<TransferResult> {
  if (!isTauri()) return { ok: false, message: 'Tauri required' };
  try {
    const result = await invoke<AztecTransferResult>('aztec_build_and_send_transfer', {
      toAddress,
      amount,
      asset,
    });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

// ============================================
// HELPERS
// ============================================

export function isAztecAddress(address: string): boolean {
  return /^0x[0-9a-f]{64}$/i.test(address);
}

export function formatAztecAddress(address: string): string {
  if (address.length !== 66) return address;
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}
