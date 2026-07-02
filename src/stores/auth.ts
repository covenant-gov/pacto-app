import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { login as apiLogin, loginWithRecoveryPhrase, createAccount as apiCreateAccount, connect as apiConnect, checkAnyAccountExists, getCurrentAccount } from '../lib/api/auth';
import { hasStoredKey, encryptAndSaveKey, encryptAndSaveEvmKey, loadAndDecryptKey, validatePrivateKeyFormat, validateRecoveryPhraseForImport } from '../lib/api/encryption';
import { dmLog } from '../lib/utils/dm-debug';
import { runPostLoginNetworkSync } from '../lib/app/post-login-sync';
import { activeTopNavTab, DEFAULT_TOP_NAV_TAB } from './navigation';
import { loadAccountState } from './persistence';
import { clearAccountState } from '../lib/utils/clear-account-state';

const SESSION_UNLOCKED_KEY = 'pacto_session_unlocked';

function markSessionUnlocked(): void {
  try {
    sessionStorage.setItem(SESSION_UNLOCKED_KEY, '1');
  } catch {
    // ignore
  }
}

function clearSessionUnlocked(): void {
  try {
    sessionStorage.removeItem(SESSION_UNLOCKED_KEY);
  } catch {
    // ignore
  }
}

function hasSessionUnlockedFlag(): boolean {
  try {
    return sessionStorage.getItem(SESSION_UNLOCKED_KEY) === '1';
  } catch {
    return false;
  }
}

// Auth state
export const isAuthenticated = writable<boolean>(false);
export const authLoading = writable<boolean>(false);
export const authError = writable<string | null>(null);

// Current user info
export interface CurrentUser {
  npub: string;
  pubkey: string;
}

export const currentUser = writable<CurrentUser | null>(null);

/** Drop frontend auth when the tab lost its unlock marker (e.g. partial unlock or HMR). */
export function clearStaleAuthSession(): void {
  if (get(isAuthenticated) && !hasSessionUnlockedFlag()) {
    isAuthenticated.set(false);
    currentUser.set(null);
  }
}

// Derived: Is user logged in with valid data
export const isLoggedIn = derived(
  [isAuthenticated, currentUser],
  ([$isAuthenticated, $currentUser]) => $isAuthenticated && $currentUser !== null
);

/**
 * Check auth status on app startup
 * Determines if user needs to login or if they have stored keys
 */
export async function checkAuthStatus(): Promise<'needs-auth' | 'needs-pin' | 'authenticated'> {
  authLoading.set(true);
  authError.set(null);

  try {
    const accountExists = await checkAnyAccountExists();

    if (!accountExists) {
      return 'needs-auth';
    }

    const keyStored = await hasStoredKey();

    if (!keyStored) {
      return 'needs-auth';
    }

    return 'needs-pin';
  } catch (error: any) {
    console.error('Auth check failed:', error);
    authError.set(error.message || 'Failed to check auth status');
    return 'needs-auth';
  } finally {
    authLoading.set(false);
  }
}

/**
 * Create a new account with generated keys
 * @param pin - 6-digit PIN for encryption
 */
export async function createAccount(pin: string): Promise<void> {
  authLoading.set(true);
  authError.set(null);

  try {
    clearAccountState();
    // Generate keys with mnemonic (initializes Nostr client)
    const keys = await apiCreateAccount();
    
    // Encrypt and save private key + mnemonic
    await encryptAndSaveKey(keys.private, pin);
    // Connect first so optional Kind 0 profile refresh can reach relays after PIN setup.
    dmLog('createAccount: connect()');
    await apiConnect();
    dmLog('createAccount: connect() done');
    if (keys.evm_private_key && keys.evm_address) {
      await encryptAndSaveEvmKey(keys.evm_private_key, keys.evm_address, pin);
    }

    // Set frontend state and load npub-scoped persistence (squads, last open, etc.)
    const npub = await getCurrentAccount();
    activeTopNavTab.set(DEFAULT_TOP_NAV_TAB);
    loadAccountState(npub);

    markSessionUnlocked();
    isAuthenticated.set(true);
    currentUser.set({
      npub: npub,
      pubkey: keys.public
    });
    dmLog('createAccount: done (fetchMessages will run from +page onMount)');
    authLoading.set(false);
  } catch (error: any) {
    console.error('Create account failed:', error);
    authError.set(error.message || 'Failed to create account');
    authLoading.set(false);
    throw error;
  }
}

/**
 * Import an existing profile from a BIP-39 recovery phrase only.
 * @param recoveryPhrase - 12- or 24-word phrase
 * @param pin - 6-digit PIN for encryption
 */
export async function importAccount(recoveryPhrase: string, pin: string): Promise<void> {
  authLoading.set(true);
  authError.set(null);

  try {
    clearAccountState();
    if (!validateRecoveryPhraseForImport(recoveryPhrase)) {
      throw new Error('Enter a valid 12- or 24-word recovery phrase');
    }

    const keys = await loginWithRecoveryPhrase(recoveryPhrase);
    
    // Encrypt and save the private key
    await encryptAndSaveKey(keys.private, pin);
    dmLog('importAccount: connect()');
    await apiConnect();
    dmLog('importAccount: connect() done');
    if (keys.evm_private_key && keys.evm_address) {
      await encryptAndSaveEvmKey(keys.evm_private_key, keys.evm_address, pin);
    }

    // Get current account npub from backend
    const npub = await getCurrentAccount();

    activeTopNavTab.set(DEFAULT_TOP_NAV_TAB);
    loadAccountState(npub);

    markSessionUnlocked();
    isAuthenticated.set(true);
    currentUser.set({
      npub: npub,
      pubkey: keys.public
    });
    authLoading.set(false);
    runPostLoginNetworkSync(npub);

    dmLog('importAccount: done');
  } catch (error: any) {
    console.error('Import account failed:', error);
    authError.set(error.message || 'Failed to import account');
    authLoading.set(false);
    throw error;
  }
}

/**
 * Unlock account with PIN (returning user)
 * @param pin - 6-digit PIN for decryption
 */
export async function unlockWithPin(pin: string): Promise<void> {
  authLoading.set(true);
  authError.set(null);

  try {
    const privateKey = await loadAndDecryptKey(pin);
    const keys = await apiLogin(privateKey);
    const npub = await getCurrentAccount();

    activeTopNavTab.set(DEFAULT_TOP_NAV_TAB);
    loadAccountState(npub);
    runPostLoginNetworkSync(npub);

    markSessionUnlocked();
    isAuthenticated.set(true);
    currentUser.set({
      npub: npub,
      pubkey: keys.public
    });

    dmLog('unlockWithPin: done');
  } catch (error: any) {
    console.error('Unlock failed:', error);
    authError.set(error.message || 'Incorrect PIN or failed to decrypt');
    throw error;
  } finally {
    authLoading.set(false);
  }
}

/**
 * Logout current user: clear all account-specific frontend state, then call
 * backend logout (deletes current account profile dir and restarts the app).
 */
export async function logout(): Promise<void> {
  authLoading.set(true);
  authError.set(null);

  const npub = get(currentUser)?.npub;

  try {
    isAuthenticated.set(false);
    currentUser.set(null);
    clearSessionUnlocked();
    clearAccountState(npub);
    await invoke('logout');
  } catch (error: any) {
    console.error('Logout failed:', error);
    authError.set(error.message || 'Failed to logout');
    isAuthenticated.set(false);
    currentUser.set(null);
    throw error;
  } finally {
    authLoading.set(false);
  }
}

/**
 * Clear auth error
 */
export function clearAuthError(): void {
  authError.set(null);
}

