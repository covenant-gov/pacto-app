import { writable, derived, get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { invoke } from '@tauri-apps/api/core';
import { login as apiLogin, loginWithRecoveryPhrase, createAccount as apiCreateAccount, connect as apiConnect, checkAnyAccountExists, getCurrentAccount, checkSession as apiCheckSession, sessionHeartbeat as apiSessionHeartbeat, unlockWithBiometricKey } from '../lib/api/auth';
import { hasStoredKey, encryptAndSaveKey, encryptAndSaveEvmKey, loadAndDecryptKey, validateRecoveryPhraseForImport } from '../lib/api/encryption';
import { dmLog } from '../lib/utils/dm-debug';
import { runPostLoginNetworkSync } from '../lib/app/post-login-sync';
import { activeTopNavTab, DEFAULT_TOP_NAV_TAB } from './navigation';
import { closeWalletSidebar } from './dm';
import { loadAccountState } from './persistence';
import { markBackupVerified, loadBackupVerified } from './backup-verification';
import { clearAccountState } from '../lib/utils/clear-account-state';
import { isMigrationGateError, getInvokeErrorMessage } from '../lib/utils/tauri-errors';
import { awaitGateBeforeAuth, freezeGate } from '../lib/updater/update-gate';
import { getBiometricUnlockData, removeBiometricUnlockData } from '../lib/api/biometry';
import { biometricUnlockEnabled } from './biometric-unlock';

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

/** Toast state shown when the backend finishes a key-derivation migration. */
export interface MigrationCompleteToast {
  shown: boolean;
  message: string;
}

export const migrationCompleteToast = writable<MigrationCompleteToast | null>(null);

/** Timer handle returned by setTimeout; alias keeps the variable type local. */
type TimerHandle = ReturnType<typeof setTimeout>;

let migrationToastTimer: TimerHandle | null = null;

/** Show the migration-complete toast for five seconds, then clear it. */
export function showMigrationCompleteToast(message = 'Account security updated'): void {
  if (migrationToastTimer !== null) {
    clearTimeout(migrationToastTimer);
    migrationToastTimer = null;
  }
  migrationToastTimer = globalThis.setTimeout(() => {
    migrationCompleteToast.set(null);
    migrationToastTimer = null;
  }, 5000);
  migrationCompleteToast.set({ shown: true, message });
}

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

let focusCheckTimer: TimerHandle | null = null;
let sessionFocusCleanup: (() => void) | null = null;
let sessionFocusListenersInstalled = false;

const FOCUS_CHECK_DEBOUNCE_MS = 50;

function debouncedCheckSession(): void {
  if (focusCheckTimer !== null) {
    clearTimeout(focusCheckTimer);
    focusCheckTimer = null;
  }
  focusCheckTimer = globalThis.setTimeout(() => {
    focusCheckTimer = null;
    void checkSession();
  }, FOCUS_CHECK_DEBOUNCE_MS);
}

/**
 * Register lightweight focus/resume listeners that verify the backend session
 * is still unlocked when the app regains focus or becomes visible again.
 * Returns a cleanup function that removes the listeners and any pending timer.
 */
export function initSessionFocusChecks(): () => void {
  if (sessionFocusListenersInstalled) {
    return sessionFocusCleanup ?? (() => {});
  }

  sessionFocusListenersInstalled = true;

  const onFocus = () => debouncedCheckSession();
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      debouncedCheckSession();
    }
  };

  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibilityChange);

  sessionFocusCleanup = () => {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    sessionFocusListenersInstalled = false;
    if (focusCheckTimer !== null) {
      clearTimeout(focusCheckTimer);
      focusCheckTimer = null;
    }
  };

  return sessionFocusCleanup;
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

export interface AdoptDevSessionParams {
  npub: string;
  pubkey: string;
}

/**
 * Post-login tail shared by `importAccount` and the debug-only dev-session
 * adoption path below: activates the default tab, loads npub-scoped
 * persistence, marks the session authenticated, and kicks off local-dev
 * defaults plus the post-login network sync.
 */
async function completePostLoginSession(npub: string, pubkey: string): Promise<void> {
  activeTopNavTab.set(DEFAULT_TOP_NAV_TAB);
  loadAccountState(npub);
  closeWalletSidebar();
  isAuthenticated.set(true);
  currentUser.set({ npub, pubkey });
  freezeGate();
  await maybeApplyLocalDevDefaults(npub);
  runPostLoginNetworkSync(npub);
}

/**
 * Hydrate frontend session state for a backend-authenticated dev identity
 * (`devLogin('full')`, see `lib/dev/autologin`). The backend already holds
 * real PIN-encrypted credentials and an open connection, so this only
 * mirrors the frontend half of a normal login.
 */
export async function adoptDevSession({ npub, pubkey }: AdoptDevSessionParams): Promise<void> {
  await completePostLoginSession(npub, pubkey);
}

/**
 * Create a new account with generated keys
 * @param pin - 6-digit PIN for encryption
 */
export async function createAccount(pin: string): Promise<void> {
  authLoading.set(true);
  authError.set(null);

  try {
    if ((await awaitGateBeforeAuth()) === 'blocked') {
      authLoading.set(false);
      return;
    }

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
    // PIN save may have marked backup_verified under PACTO_ALLOW_TEST_AUTH;
    // wait for the store so invite Accept is not a silent no-op.
    await loadBackupVerified();
    closeWalletSidebar();
    runPostLoginNetworkSync(npub);

    isAuthenticated.set(true);
    currentUser.set({
      npub: npub,
      pubkey: keys.public
    });
    freezeGate();
    await maybeApplyLocalDevDefaults(npub);

    dmLog('createAccount: done');
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
    if ((await awaitGateBeforeAuth()) === 'blocked') {
      authLoading.set(false);
      return;
    }

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
    await completePostLoginSession(npub, keys.public);
    await markBackupVerified(true);
    authLoading.set(false);

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
    if ((await awaitGateBeforeAuth()) === 'blocked') return;

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
    freezeGate();
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
 * Unlock account using key material recovered from OS biometric storage
 * (Touch ID / Windows Hello) instead of a typed PIN.
 * @param npub - the account to unlock; used to look up the stored key material
 */
export async function unlockWithBiometrics(npub: string): Promise<void> {
  authLoading.set(true);
  authError.set(null);

  try {
    if ((await awaitGateBeforeAuth()) === 'blocked') return;

    const reason = get(t)('auth.biometricUnlockPromptReason');
    const keyHex = await getBiometricUnlockData(npub, reason);
    const keys = await unlockWithBiometricKey(keyHex).catch((error: unknown) => {
      // Only a rejection here proves the backend-validated key no longer decrypts
      // (stale/corrupted stored blob): revoke so the user re-enrolls after a PIN
      // unlock. A cancelled or unavailable OS prompt above leaves a valid
      // enrollment untouched so the user can simply retry.
      void removeBiometricUnlockData(npub).catch(() => {});
      biometricUnlockEnabled.set(false);
      throw error;
    });
    const unlockedNpub = await getCurrentAccount();

    await completePostLoginSession(unlockedNpub, keys.public);

    dmLog('unlockWithBiometrics: done');
  } catch (error: unknown) {
    console.error('Biometric unlock failed:', error);
    authError.set(getInvokeErrorMessage(error, 'Biometric unlock failed'));
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

