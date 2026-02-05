import { writable, derived } from 'svelte/store';
import { login as apiLogin, createAccount as apiCreateAccount, connect as apiConnect, checkAnyAccountExists, getCurrentAccount } from '../lib/api/auth';
import { hasStoredKey, encryptAndSaveKey, loadAndDecryptKey, clearStoredKey, validatePrivateKeyFormat } from '../lib/api/encryption';
import { refreshProfileNow, fetchMessages } from '../lib/api/nostr';

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
    // Check if any account exists
    const accountExists = await checkAnyAccountExists();
    
    if (!accountExists) {
      authLoading.set(false);
      return 'needs-auth'; // New user, show welcome screen
    }

    // Check if we have a stored key
    const keyStored = await hasStoredKey();
    
    if (!keyStored) {
      authLoading.set(false);
      return 'needs-auth'; // Account exists but no key, needs re-login
    }

    // Key exists but not authenticated yet
    authLoading.set(false);
    return 'needs-pin'; // Returning user, show PIN unlock
  } catch (error: any) {
    console.error('Auth check failed:', error);
    authError.set(error.message || 'Failed to check auth status');
    authLoading.set(false);
    return 'needs-auth';
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
    // Generate keys with mnemonic (initializes Nostr client)
    const keys = await apiCreateAccount();
    
    // Encrypt and save private key + mnemonic
    await encryptAndSaveKey(keys.private, pin);
    
    // Connect to relays
    await apiConnect();
    
    // Set frontend state
    const npub = await getCurrentAccount();
    isAuthenticated.set(true);
    currentUser.set({
      npub: npub,
      pubkey: keys.public
    });
    // Pull DMs from Nostr relays (backend fetches Gift Wraps, emits init_finished with chats)
    fetchMessages(true).catch((e) => console.error('fetch_messages failed:', e));

    authLoading.set(false);
  } catch (error: any) {
    console.error('Create account failed:', error);
    authError.set(error.message || 'Failed to create account');
    authLoading.set(false);
    throw error;
  }
}

/**
 * Import existing keys and create account
 * @param privateKey - Private key in nsec or hex format
 * @param pin - 6-digit PIN for encryption
 */
export async function importAccount(privateKey: string, pin: string): Promise<void> {
  authLoading.set(true);
  authError.set(null);

  try {
    // Validate key format
    if (!validatePrivateKeyFormat(privateKey)) {
      throw new Error('Invalid private key format');
    }

    // Login with the imported key
    const keys = await apiLogin(privateKey);
    
    // Encrypt and save the private key
    await encryptAndSaveKey(keys.private, pin);
    
    // Connect to relays
    await apiConnect();
    
    // Get current account npub from backend
    const npub = await getCurrentAccount();
    
    // Set auth state
    isAuthenticated.set(true);
    currentUser.set({
      npub: npub,
      pubkey: keys.public
    });
    // Pull DMs from Nostr relays (backend fetches Gift Wraps, emits init_finished with chats)
    fetchMessages(true).catch((e) => console.error('fetch_messages failed:', e));

    // Auto-refresh profile on login
    try {
      await refreshProfileNow(npub);
    } catch (e) {
      console.error('Auto profile refresh failed:', e);
      // Don't fail login if profile refresh fails
    }

    authLoading.set(false);
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
    // Decrypt the stored key
    const privateKey = await loadAndDecryptKey(pin);
    
    // Login with the decrypted key
    const keys = await apiLogin(privateKey);
    
    // Connect to relays
    await apiConnect();
    
    // Get current account npub from backend
    const npub = await getCurrentAccount();
    
    // Set auth state
    isAuthenticated.set(true);
    currentUser.set({
      npub: npub,
      pubkey: keys.public
    });
    // Pull DMs from Nostr relays (backend fetches Gift Wraps, emits init_finished with chats)
    fetchMessages(true).catch((e) => console.error('fetch_messages failed:', e));

    // Auto-refresh profile on login
    try {
      await refreshProfileNow(npub);
    } catch (e) {
      console.error('Auto profile refresh failed:', e);
      // Don't fail login if profile refresh fails
    }

    authLoading.set(false);
  } catch (error: any) {
    console.error('Unlock failed:', error);
    authError.set(error.message || 'Incorrect PIN or failed to decrypt');
    authLoading.set(false);
    throw error;
  }
}

/**
 * Logout current user
 * Optionally clear stored keys
 */
export async function logout(clearKeys: boolean = false): Promise<void> {
  authLoading.set(true);
  authError.set(null);

  try {
    if (clearKeys) {
      await clearStoredKey();
    }
    
    // Clear auth state
    isAuthenticated.set(false);
    currentUser.set(null);
    
    // TODO: Call backend logout if needed
    // await invoke('logout');
    
    authLoading.set(false);
  } catch (error: any) {
    console.error('Logout failed:', error);
    authError.set(error.message || 'Failed to logout');
    authLoading.set(false);
    
    // Still clear state even if backend fails
    isAuthenticated.set(false);
    currentUser.set(null);
  }
}

/**
 * Clear auth error
 */
export function clearAuthError(): void {
  authError.set(null);
}

