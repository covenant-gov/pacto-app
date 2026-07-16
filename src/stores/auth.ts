import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { login as apiLogin, loginWithRecoveryPhrase, createAccount as apiCreateAccount, connect as apiConnect, checkAnyAccountExists, getCurrentAccount, checkSession as apiCheckSession, sessionHeartbeat as apiSessionHeartbeat } from '../lib/api/auth';
import { hasStoredKey, encryptAndSaveKey, encryptAndSaveEvmKey, loadAndDecryptKey, validateRecoveryPhraseForImport } from '../lib/api/encryption';
import { dmLog } from '../lib/utils/dm-debug';
import { runPostLoginNetworkSync } from '../lib/app/post-login-sync';
import { activeTopNavTab, DEFAULT_TOP_NAV_TAB } from './navigation';
import { closeWalletSidebar } from './dm';
import { loadAccountState } from './persistence';
import { clearAccountState } from '../lib/utils/clear-account-state';
import { isMigrationGateError } from '../lib/utils/tauri-errors';

async function maybeApplyLocalDevDefaults(npub: string): Promise<void> {
  if (!import.meta.env.DEV) return;
  const { applyLocalDevDefaults } = await import('../lib/dev/local-dev-setup');
  await applyLocalDevDefaults(npub);
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

/** Drop frontend auth state. Called when the backend reports the session is locked. */
export function dropSessionState(): void {
  isAuthenticated.set(false);
  currentUser.set(null);
}

/** Query the backend for the current session state. Fail-secure: errors are treated as locked. */
export async function checkSession(): Promise<{ unlocked: boolean; lockedAt?: number }> {
  try {
    const status = await apiCheckSession();
    if (!status.unlocked) {
      dropSessionState();
    }
    return status;
  } catch (error: unknown) {
    console.error('checkSession failed:', error);
    dropSessionState();
    return { unlocked: false };
  }
}

/** Reset the backend idle timer. Lightweight no-op if the session is already locked. */
export async function sessionHeartbeat(): Promise<void> {
  try {
    await apiSessionHeartbeat();
  } catch (error: unknown) {
    console.error('sessionHeartbeat failed:', error);
  }
}

/**
 * Verify the session is still unlocked before a sensitive operation.
 * Returns true if unlocked; otherwise drops auth state and returns false.
 */
export async function maybeRequireSession(): Promise<boolean> {
  const status = await checkSession();
  if (!status.unlocked) {
    dropSessionState();
    return false;
  }
  return true;
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
  } catch (error: unknown) {
    console.error('Auth check failed:', error);
    authError.set(error instanceof Error ? error.message : 'Failed to check auth status');
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
    closeWalletSidebar();

    isAuthenticated.set(true);
    currentUser.set({
      npub: npub,
      pubkey: keys.public
    });
    await maybeApplyLocalDevDefaults(npub);

    dmLog('createAccount: done (fetchMessages will run from +page onMount)');
    authLoading.set(false);
  } catch (error: unknown) {
    console.error('Create account failed:', error);
    authError.set(error instanceof Error ? error.message : 'Failed to create account');
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
    closeWalletSidebar();

    isAuthenticated.set(true);
    currentUser.set({
      npub: npub,
      pubkey: keys.public
    });
    await maybeApplyLocalDevDefaults(npub);
    authLoading.set(false);
    runPostLoginNetworkSync(npub);

    dmLog('importAccount: done');
  } catch (error: unknown) {
    console.error('Import account failed:', error);
    authError.set(error instanceof Error ? error.message : 'Failed to import account');
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
    closeWalletSidebar();
    runPostLoginNetworkSync(npub);

    isAuthenticated.set(true);
    currentUser.set({
      npub: npub,
      pubkey: keys.public
    });
    await maybeApplyLocalDevDefaults(npub);

    dmLog('unlockWithPin: done');
  } catch (error: unknown) {
    console.error('Unlock failed:', error);
    authError.set(error instanceof Error ? error.message : 'Incorrect PIN or failed to decrypt');
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
    clearAccountState(npub);
    await invoke('logout');
  } catch (error: unknown) {
    console.error('Logout failed:', error);
    authError.set(error instanceof Error ? error.message : 'Failed to logout');
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

/**
 * If `error` is the backend migration-gate error, drop the frontend session
 * so the user is returned to the unlock screen. The next successful unlock
 * will run the migration engine and bring the account to version 2.
 */
export function handleMigrationGateError(error: unknown): boolean {
  if (isMigrationGateError(error)) {
    dropSessionState();
    authError.set('Please unlock to update account security.');
    return true;
  }
  return false;
}

