import { invoke } from "@tauri-apps/api/core";
import { updateProfile } from "./nostr";

// Type definitions matching Rust structs
export interface LoginKeyPair {
  public: string;
  private: string;
  evm_private_key?: string | null;
  evm_address?: string | null;
}

/**
 * Unlock or dev hot-reload: **nsec only**. For onboarding import use `loginWithRecoveryPhrase`.
 */
export async function login(importKey: string = ''): Promise<LoginKeyPair> {
  return await invoke('login', { importKey });
}

/**
 * Import a new profile from a BIP-39 recovery phrase (12 or 24 words).
 * Sets in-memory seed so the first `encrypt` after PIN persists it like `create_account`.
 */
export async function loginWithRecoveryPhrase(mnemonic: string): Promise<LoginKeyPair> {
  return await invoke('login_with_recovery_phrase', { mnemonic });
}

/**
 * Create a new account with generated keys and mnemonic
 * @returns Public and private keys (Nostr client already initialized)
 */
export async function createAccount(): Promise<LoginKeyPair> {
  return await invoke('create_account');
}

/**
 * Connect to Nostr relays
 * @returns True if connected, false if already connected
 */
export async function connect(): Promise<boolean> {
  return await invoke('connect');
}

/**
 * Check if any account exists on this device
 * @returns True if at least one account exists
 */
export async function checkAnyAccountExists(): Promise<boolean> {
  return await invoke('check_any_account_exists');
}

/**
 * Get the current active account npub
 * @returns Current account npub or error
 */
export async function getCurrentAccount(): Promise<string> {
  return await invoke('get_current_account');
}

/** Backend session state. */
export interface SessionStatus {
  unlocked: boolean;
  lockedAt?: number;
}

/**
 * Ask the backend whether the encryption key is present in memory.
 * @returns Unlocked status and optional Unix epoch seconds when the session locked.
 */
export async function checkSession(): Promise<SessionStatus> {
  return await invoke<SessionStatus>('check_session');
}

/**
 * Reset the backend idle timer. Lightweight; safe to call often.
 */
export async function sessionHeartbeat(): Promise<void> {
  await invoke('session_heartbeat');
}

/**
 * Get the stored EVM address for the current account (no PIN required; address is public).
 */
export async function getEvmAddress(): Promise<string | null> {
  return await invoke<string | null>('get_evm_address');
}

/**
 * Store the EVM address for the current account (called when saving keys after create/import).
 */
export async function setEvmAddress(address: string): Promise<void> {
  await invoke('set_evm_address', { address });
  try {
    await updateProfile({ name: '', avatar: '', banner: '', about: '' });
  } catch {
    // Relays offline or client not ready; local state still holds the address.
  }
}

/**
 * Sign a 32-byte Ethereum hash (hex string) with the stored EVM key.
 * Returns a 65-byte signature as 0x-prefixed hex (r || s || v).
 */
export async function signEvmHash(hashHex: string): Promise<string> {
  return await invoke<string>('sign_evm_hash', { hashHex });
}

/**
 * List all accounts on this device
 * @returns Array of account npubs
 */
export async function listAllAccounts(): Promise<string[]> {
  return await invoke('list_all_accounts');
}

/**
 * Result returned by `export_sensitive_to_clipboard`.
 * The raw secret never leaves the backend; only metadata crosses the IPC boundary.
 */
export interface SensitiveExportResult {
  exportType: string;
  accountId: string;
  clearedAt: number;
}

/**
 * Export a sensitive secret to the system clipboard without exposing it to the webview.
 * The backend writes the secret directly to the clipboard and clears it after 90 seconds.
 */
export async function exportSensitiveToClipboard(
  exportType: 'evm' | 'nostr' | 'seed',
  accountId: string | undefined,
  pin: string
): Promise<SensitiveExportResult> {
  const backendExportType = frontendToBackendExportType(exportType);
  const result = await invoke<SensitiveExportResult>('export_sensitive_to_clipboard', {
    exportType: backendExportType,
    accountId,
    pin,
  });
  return { ...result, exportType: backendToFrontendExportType(result.exportType) };
}

function frontendToBackendExportType(exportType: 'evm' | 'nostr' | 'seed'): string {
  switch (exportType) {
    case 'evm':
      return 'evm_account';
    case 'nostr':
      return 'nostr_nsec';
    case 'seed':
      return 'seed_phrase';
    default:
      return exportType;
  }
}

function backendToFrontendExportType(exportType: string): 'evm' | 'nostr' | 'seed' {
  switch (exportType) {
    case 'evm_account':
      return 'evm';
    case 'nostr_nsec':
      return 'nostr';
    case 'seed_phrase':
      return 'seed';
    default:
      return exportType as 'evm' | 'nostr' | 'seed';
  }
}

/**
 * Diagnostic snapshot of the local key-derivation state. Used to understand why
 * a PIN unlock is failing without exposing plaintext secrets.
 */
export interface UnlockDiagnostic {
  version: number;
  migrationInProgress: boolean;
  hasSalt: boolean;
  hasPkey: boolean;
  hasSeed: boolean;
  hasSentinel: boolean;
  pkeyDecryptsNew: boolean;
  pkeyDecryptsLegacy: boolean;
  seedDecryptsNew: boolean;
  seedDecryptsLegacy: boolean;
}

/**
 * Run a diagnostic check to understand why a PIN unlock is failing. Returns
 * booleans indicating which key can decrypt which stored secret. The password
 * is used to derive the candidate keys, but no plaintext is returned.
 */
export async function diagnoseUnlockState(pin: string): Promise<UnlockDiagnostic> {
  return await invoke<UnlockDiagnostic>('diagnose_key_derivation_state', { password: pin });
}

