import { invoke } from "@tauri-apps/api/core";
import { setEvmAddress } from "./auth";

/**
 * Check if an encrypted private key is stored locally
 * @returns True if encrypted key exists
 */
export async function hasStoredKey(): Promise<boolean> {
  try {
    const pkey = await invoke<string | null>('get_pkey');
    return pkey !== null && pkey !== undefined && pkey !== '';
  } catch {
    return false;
  }
}

/**
 * Encrypt and save a private key with a PIN
 * @param privateKey - The private key to encrypt
 * @param pin - The 6-digit PIN for encryption
 */
export async function encryptAndSaveKey(privateKey: string, pin: string): Promise<void> {
  // Encrypt the private key using the PIN as password
  const encryptedKey = await invoke<string>('encrypt', { 
    input: privateKey, 
    password: pin 
  });
  
  // Store the encrypted key
  await invoke('set_pkey', { pkey: encryptedKey });
}

/**
 * Encrypt and save the EVM private key, and store the EVM address (public).
 * Call after encryptAndSaveKey when the login/create response includes evm_private_key and evm_address.
 */
export async function encryptAndSaveEvmKey(
  evmPrivateKey: string,
  evmAddress: string,
  pin: string
): Promise<void> {
  const encryptedEvm = await invoke<string>('encrypt', {
    input: evmPrivateKey,
    password: pin
  });
  await invoke('set_evm_pkey', { evmPkey: encryptedEvm });
  await setEvmAddress(evmAddress);
}

/**
 * Load and decrypt a private key using a PIN
 * @param pin - The 6-digit PIN for decryption
 * @returns The decrypted private key
 * @throws Error if key doesn't exist or PIN is incorrect
 */
export async function loadAndDecryptKey(pin: string): Promise<string> {
  const encryptedKey = await invoke<string | null>('get_pkey');
  
  if (!encryptedKey) {
    throw new Error('No stored key found');
  }
  
  // Decrypt the key using the PIN as password
  try {
    const decryptedKey = await invoke<string>('decrypt', { 
      ciphertext: encryptedKey, 
      password: pin 
    });
    return decryptedKey;
  } catch (error) {
    throw new Error('Incorrect PIN', { cause: error });
  }
}

/**
 * Clear stored encrypted key (logout)
 */
export async function clearStoredKey(): Promise<void> {
  // Sets empty string to clear the key
  await invoke('set_pkey', { pkey: '' });
}

/**
 * Validate if a string is a valid Nostr private key format (nsec or 64-char hex).
 * Use for unlock / advanced paths — **not** for onboarding import (use `validateRecoveryPhraseForImport`).
 */
export function validatePrivateKeyFormat(key: string): boolean {
  const trimmed = key.trim();

  if (trimmed.startsWith('nsec1')) {
    return trimmed.length === 63;
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Import onboarding: 12- or 24-word recovery phrase only (rejects nsec / hex).
 */
export function validateRecoveryPhraseForImport(input: string): boolean {
  const t = input.trim();
  if (!t || t.startsWith('nsec1')) return false;
  if (/^[0-9a-fA-F]{64}$/.test(t)) return false;
  const words = t.split(/\s+/).filter((w) => w.length > 0);
  return words.length === 12 || words.length === 24;
}

