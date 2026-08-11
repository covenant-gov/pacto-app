import { invoke } from "./index";
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
 * Report whether every local profile is safe for this build. Additive-ahead
 * schema skew is auto-rewound before the report; `allRecognized === false`
 * means at least one **breaking** profile remains (launch gate blocks).
 */
export interface StorageCompatibilityReport {
  allRecognized: boolean;
  unrecognizedCount: number;
  highestOffendingVersion: number | null;
  supportedSchemaVersion: number;
}

export async function getStorageCompatibility(): Promise<StorageCompatibilityReport> {
  return await invoke('get_storage_compatibility');
}

/**
 * Get the current active account npub
 * @returns Current account npub or error
 */
export async function getCurrentAccount(): Promise<string> {
  return await invoke('get_current_account');
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
 * Query the backend session manager for the current lock/unlock state.
 */
export async function checkSession(): Promise<{ unlocked: boolean; lockedAt?: number }> {
  return await invoke('check_session');
}

/**
 * Send a heartbeat to the backend session manager to reset the idle timer.
 */
export async function sessionHeartbeat(): Promise<void> {
  return await invoke('session_heartbeat');
}

/**
 * Set the idle auto-lock timeout in minutes.
 */
export async function setSessionTimeout(timeoutMinutes: number): Promise<void> {
  return await invoke('set_session_timeout', { timeoutMinutes });
}

/**
 * Get the current idle auto-lock timeout in minutes.
 */
export async function getSessionTimeout(): Promise<number> {
  return await invoke('get_session_timeout');
}

/**
 * Export the stored BIP-39 recovery phrase (requires PIN unlock / encryption key in memory).
 */
export async function exportRecoveryPhrase(): Promise<string> {
  const seed = await invoke<string | null>('get_seed');
  if (!seed?.trim()) {
    throw new Error(
      'No recovery phrase is stored for this account. If you unlocked with nsec only, export nsec from Nostr settings instead.'
    );
  }
  return seed.trim();
}

/**
 * Export one EVM account private key (requires PIN unlock / encryption key in memory).
 */
export async function exportEvmAccountKeyPlaintext(accountId: string): Promise<string> {
  return await invoke<string>('export_evm_account_key_plaintext', { accountId });
}

