/**
 * Tauri backend wallet commands (balances + sign/broadcast). Private keys stay in Rust.
 */

import { invoke } from '@tauri-apps/api/core';
import type { SupportedChainId } from './chains';
import type { WalletUsdSpotPrices } from './pricing';
import type { WatchedErc20Wire } from './watched-tokens';

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as { __TAURI__?: unknown }).__TAURI__;
}

export interface WalletSummaryAsset {
  symbol: string;
  balanceRaw: string;
  balanceDecimal: string;
  usdValue: number | null;
}

export interface WalletSummaryNetwork {
  network: string;
  chainId: number;
  assets: WalletSummaryAsset[];
  /** Set when this network's RPC could not be reached; other networks still populate. */
  error?: string;
}

export interface WalletSummary {
  networks: WalletSummaryNetwork[];
  totalUsdApprox: number;
  prices: WalletUsdSpotPrices;
}

export type WalletSummaryResult =
  | { ok: true; summary: WalletSummary }
  | { ok: false; message: string };

export interface EvmNativeBalance {
  balanceRaw: string;
  balanceDecimal: string;
  symbol: string;
}

export type EvmNativeBalanceResult =
  | { ok: true; balance: EvmNativeBalance }
  | { ok: false; message: string };

/** Native ETH balance for one address on a wallet network key. */
export async function getEvmNativeBalance(
  network: SupportedChainId,
  address: string
): Promise<EvmNativeBalanceResult> {
  if (!isTauri()) {
    return { ok: false, message: 'Balances are only available in the desktop app.' };
  }
  const addr = address.trim();
  if (!addr) {
    return { ok: false, message: 'Address is required.' };
  }
  try {
    const balance = await invoke<EvmNativeBalance>('get_evm_native_balance', {
      network,
      address: addr,
    });
    return { ok: true, balance };
  } catch (e) {
    const msg =
      typeof e === 'string'
        ? e
        : e != null && typeof (e as Error).message === 'string'
          ? (e as Error).message
          : 'Could not load balance.';
    return { ok: false, message: msg };
  }
}

/**
 * Per-network + per-asset balances with USD lines (Chainlink-backed prices from backend).
 * Only `enabledChains` are queried; an unreachable network returns a per-network `error`
 * on its summary row instead of failing the whole call.
 */
export async function getWalletSummary(
  watchedErc20s: WatchedErc20Wire[],
  enabledChains: SupportedChainId[]
): Promise<WalletSummaryResult> {
  if (!isTauri()) {
    return { ok: false, message: 'Wallet summary is only available in the desktop app.' };
  }
  try {
    const summary = await invoke<WalletSummary>('get_wallet_summary', {
      watchedErc20s,
      enabledChains,
    });
    return { ok: true, summary };
  } catch (e) {
    const msg =
      typeof e === 'string'
        ? e
        : e != null && typeof (e as Error).message === 'string'
          ? (e as Error).message
          : 'Could not load wallet summary.';
    return { ok: false, message: msg };
  }
}

export interface WalletSendResult {
  txHash: string;
  network: string;
  chainId: number;
  /** Decimal string block number from receipt, when the RPC provided it. */
  blockNumber?: string;
}

/** After on-chain success, used to refresh balances and post a `wallet_tx_announcement` DM. */
export interface WalletTransferSuccessDetail {
  result: WalletSendResult;
  network: SupportedChainId;
  /** Ticker shown in DMs (ETH, USDC, or an imported symbol). */
  asset: string;
  amount: string;
  /** When paying a `wallet_tx_request`, included on the announcement JSON. */
  requestId?: string;
}

export interface WalletOpParsedError {
  code: string;
  message: string;
  npub?: string;
  /** Present for some errors (e.g. receipt timeout after broadcast). */
  txHash?: string;
}

export type WalletSendResultOutcome =
  | { ok: true; result: WalletSendResult }
  | { ok: false; message: string; parsed?: WalletOpParsedError };

export function parseWalletOpError(raw: string): WalletOpParsedError | null {
  const t = raw.trim();
  if (!t.startsWith('{')) return null;
  try {
    const o = JSON.parse(t) as {
      code?: string;
      message?: string;
      npub?: string;
      txHash?: string;
    };
    if (o && typeof o.code === 'string' && typeof o.message === 'string') {
      return {
        code: o.code,
        message: o.message,
        npub: o.npub,
        txHash: typeof o.txHash === 'string' ? o.txHash : undefined,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Build, sign, and broadcast a transfer to the peer's DM-exchanged payout address (`dm_peer_evm`, with legacy `profiles.evm_address` fallback).
 * Tauri maps camelCase keys to the Rust command's `snake_case` parameters.
 */
export async function walletBuildAndSendTransaction(
  toNpub: string,
  network: SupportedChainId,
  asset: string,
  amount: string,
  erc20Transfer?: { address: string; decimals: number } | null,
  /** When set, send to this `0x` address from Settings. `toNpub` is then ignored by the backend. */
  toAddressEvm?: string | null,
  waitForConfirmation = false,
): Promise<WalletSendResultOutcome> {
  if (!isTauri()) {
    return { ok: false, message: 'Sending is only available in the desktop app.' };
  }
  try {
    const result = await invoke<WalletSendResult>('wallet_build_and_send_transaction', {
      toNpub,
      network,
      asset,
      amount: amount.trim(),
      erc20Transfer: erc20Transfer ?? null,
      toAddressEvm: toAddressEvm?.trim() ? toAddressEvm.trim() : null,
      waitForConfirmation,
    });
    return { ok: true, result };
  } catch (e) {
    const raw =
      typeof e === 'string'
        ? e
        : e != null && typeof (e as Error).message === 'string'
          ? (e as Error).message
          : 'Send failed.';
    const parsed = parseWalletOpError(raw);
    return { ok: false, message: parsed?.message ?? raw, parsed: parsed ?? undefined };
  }
}

export async function walletWaitForTransaction(
  network: SupportedChainId,
  txHash: string,
): Promise<WalletSendResultOutcome> {
  if (!isTauri()) {
    return { ok: false, message: 'Confirmation polling is only available in the desktop app.' };
  }
  try {
    const result = await invoke<WalletSendResult>('wallet_wait_for_transaction', {
      network,
      txHash: txHash.trim(),
    });
    return { ok: true, result };
  } catch (e) {
    const raw =
      typeof e === 'string'
        ? e
        : e != null && typeof (e as Error).message === 'string'
          ? (e as Error).message
          : 'Confirmation failed.';
    const parsed = parseWalletOpError(raw);
    return { ok: false, message: parsed?.message ?? raw, parsed: parsed ?? undefined };
  }
}

/** Result from `safe_deploy_proxy` (camelCase from Tauri). */
export interface SafeDeployProxyResult {
  txHash: string;
  safeAddress: string;
  chain: string;
  chainId: number;
}

export type SafeDeployProxyOutcome =
  | { ok: true; result: SafeDeployProxyResult }
  | { ok: false; message: string; parsed?: WalletOpParsedError };

/**
 * Deploy a new Safe 1.3.0 via the proxy factory using the embedded EVM key (pays gas).
 * Owners must be unique `0x` hex addresses; backend sorts and validates.
 */
export async function safeDeployProxy(
  network: SupportedChainId,
  owners: string[],
  threshold: number,
  saltNonce?: string | null,
  parentId?: string | null,
): Promise<SafeDeployProxyOutcome> {
  if (!isTauri()) {
    return { ok: false, message: 'Deploy is only available in the desktop app.' };
  }
  try {
    const result = await invoke<SafeDeployProxyResult>('safe_deploy_proxy', {
      network,
      owners,
      threshold,
      saltNonce: saltNonce ?? null,
      parentId: parentId?.trim() ? parentId.trim() : null,
    });
    return { ok: true, result };
  } catch (e) {
    const raw =
      typeof e === 'string'
        ? e
        : e != null && typeof (e as Error).message === 'string'
          ? (e as Error).message
          : 'Deploy failed.';
    const parsed = parseWalletOpError(raw);
    return { ok: false, message: parsed?.message ?? raw, parsed: parsed ?? undefined };
  }
}

/** Short user-facing copy for Safe deploy when the JSON message is noisy RPC text. */
export function userFacingDeploySafeMessage(parsed: WalletOpParsedError | undefined): string {
  if (!parsed) return 'Deploy failed.';
  const { code, message } = parsed;
  if (code === 'SEND_FAILED' && message.length > 120) {
    return 'Could not submit the transaction. Check your native balance and network connection.';
  }
  if (code === 'RPC_CONNECT') {
    return "Couldn't reach the RPC. Try again in a moment or set ALCHEMY_RPC_KEY in `.env` (see `.env.example`).";
  }
  if (code === 'NO_EVM_KEY') {
    return 'No embedded wallet key on this account. Use an account that was created or imported with an EVM wallet.';
  }
  return message;
}
