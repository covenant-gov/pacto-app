import { invoke } from "@tauri-apps/api/core";

// Type definitions matching Rust structs
export interface LoginKeyPair {
  public: string;
  private: string;
  evm_private_key?: string | null;
  evm_address?: string | null;
}

/**
 * Login with a private key (imports existing account)
 * @param importKey - Private key in nsec format OR 12-word BIP39 mnemonic
 * @returns Public and private keys
 */
export async function login(importKey: string = ''): Promise<LoginKeyPair> {
  return await invoke('login', { importKey });
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
 * Export account keys (requires PIN for decryption)
 * @returns Object containing nsec, optional seed_phrase, and optional evm_private_key
 */
export async function exportKeys(): Promise<{
  nsec: string;
  seed_phrase?: string;
  evm_private_key?: string | null;
}> {
  return await invoke('export_keys');
}

