import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import {
  isAuthenticated,
  authLoading,
  authError,
  currentUser,
  isLoggedIn,
  checkAuthStatus,
  createAccount,
  importAccount,
  unlockWithPin,
  logout,
  clearAuthError,
} from './auth';
import {
  login,
  loginWithRecoveryPhrase,
  createAccount as apiCreateAccount,
  connect,
  checkAnyAccountExists,
  getCurrentAccount,
} from '../lib/api/auth';
import {
  hasStoredKey,
  encryptAndSaveKey,
  encryptAndSaveEvmKey,
  loadAndDecryptKey,
  validateRecoveryPhraseForImport,
} from '../lib/api/encryption';
import { runPostLoginNetworkSync } from '../lib/app/post-login-sync';
import { loadAccountState } from './persistence';
import { clearAccountState } from '../lib/utils/clear-account-state';
import { activeTopNavTab, DEFAULT_TOP_NAV_TAB } from './navigation';
import { setCurrentNpubForPersistence } from './persistence-context';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../lib/api/auth', () => ({
  login: vi.fn(),
  loginWithRecoveryPhrase: vi.fn(),
  createAccount: vi.fn(),
  connect: vi.fn(),
  checkAnyAccountExists: vi.fn(),
  getCurrentAccount: vi.fn(),
}));

vi.mock('../lib/api/encryption', () => ({
  hasStoredKey: vi.fn(),
  encryptAndSaveKey: vi.fn(),
  encryptAndSaveEvmKey: vi.fn(),
  loadAndDecryptKey: vi.fn(),
  validatePrivateKeyFormat: vi.fn(),
  validateRecoveryPhraseForImport: vi.fn(),
}));

vi.mock('../lib/app/post-login-sync', () => ({
  runPostLoginNetworkSync: vi.fn(),
}));

vi.mock('./persistence', () => ({
  loadAccountState: vi.fn(),
}));

vi.mock('../lib/utils/clear-account-state', () => ({
  clearAccountState: vi.fn(),
}));

function setDev(value: boolean) {
  (import.meta.env as { DEV?: boolean }).DEV = value;
}

describe('auth', () => {
  const npub = 'npub1test';
  const keys = {
    private: 'nsec1private',
    public: 'pubkey',
    evm_private_key: '0xevmprivate',
    evm_address: '0xevmaddress',
  };

  beforeEach(() => {
    setDev(false);
    vi.mocked(checkAnyAccountExists).mockReset();
    vi.mocked(hasStoredKey).mockReset();
    vi.mocked(apiCreateAccount).mockReset();
    vi.mocked(encryptAndSaveKey).mockReset();
    vi.mocked(encryptAndSaveEvmKey).mockReset();
    vi.mocked(connect).mockReset();
    vi.mocked(getCurrentAccount).mockReset();
    vi.mocked(loginWithRecoveryPhrase).mockReset();
    vi.mocked(validateRecoveryPhraseForImport).mockReset();
    vi.mocked(loadAndDecryptKey).mockReset();
    vi.mocked(login).mockReset();
    vi.mocked(runPostLoginNetworkSync).mockReset();
    vi.mocked(loadAccountState).mockReset();
    vi.mocked(clearAccountState).mockReset();
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    isAuthenticated.set(false);
    authLoading.set(false);
    authError.set(null);
    currentUser.set(null);
    activeTopNavTab.set(DEFAULT_TOP_NAV_TAB);
    setCurrentNpubForPersistence(null);
    vi.clearAllMocks();
  });

  it('has expected initial values', () => {
    expect(get(isAuthenticated)).toBe(false);
    expect(get(authLoading)).toBe(false);
    expect(get(authError)).toBeNull();
    expect(get(currentUser)).toBeNull();
    expect(get(isLoggedIn)).toBe(false);
  });

  describe('isLoggedIn', () => {
    it('is true when authenticated and user is set', () => {
      isAuthenticated.set(true);
      currentUser.set({ npub, pubkey: 'pk' });
      expect(get(isLoggedIn)).toBe(true);
    });

    it('is false when not authenticated', () => {
      currentUser.set({ npub, pubkey: 'pk' });
      expect(get(isLoggedIn)).toBe(false);
    });

    it('is false when user is missing', () => {
      isAuthenticated.set(true);
      expect(get(isLoggedIn)).toBe(false);
    });
  });

  describe('checkAuthStatus', () => {
    it('returns needs-auth when no account exists', async () => {
      vi.mocked(checkAnyAccountExists).mockResolvedValue(false);
      const status = await checkAuthStatus();
      expect(status).toBe('needs-auth');
    });

    it('returns needs-auth when account exists but no stored key', async () => {
      vi.mocked(checkAnyAccountExists).mockResolvedValue(true);
      vi.mocked(hasStoredKey).mockResolvedValue(false);
      const status = await checkAuthStatus();
      expect(status).toBe('needs-auth');
    });

    it('returns needs-pin when account and key exist', async () => {
      vi.mocked(checkAnyAccountExists).mockResolvedValue(true);
      vi.mocked(hasStoredKey).mockResolvedValue(true);
      const status = await checkAuthStatus();
      expect(status).toBe('needs-pin');
    });

    it('sets auth error on failure and returns needs-auth', async () => {
      vi.mocked(checkAnyAccountExists).mockRejectedValue(new Error('backend down'));
      const status = await checkAuthStatus();
      expect(status).toBe('needs-auth');
      expect(get(authError)).toBe('backend down');
    });
  });

  describe('createAccount', () => {
    it('creates and sets up a new account', async () => {
      vi.mocked(apiCreateAccount).mockResolvedValue(keys);
      vi.mocked(getCurrentAccount).mockResolvedValue(npub);

      await createAccount('123456');

      expect(clearAccountState).toHaveBeenCalled();
      expect(encryptAndSaveKey).toHaveBeenCalledWith(keys.private, '123456');
      expect(encryptAndSaveEvmKey).toHaveBeenCalledWith(keys.evm_private_key, keys.evm_address, '123456');
      expect(get(isAuthenticated)).toBe(true);
      expect(get(currentUser)).toEqual({ npub, pubkey: keys.public });
      expect(get(activeTopNavTab)).toBe(DEFAULT_TOP_NAV_TAB);
      expect(loadAccountState).toHaveBeenCalledWith(npub);
    });

    it('sets auth error on failure', async () => {
      vi.mocked(apiCreateAccount).mockRejectedValue(new Error('key gen failed'));
      await expect(createAccount('123456')).rejects.toThrow('key gen failed');
      expect(get(authError)).toBe('key gen failed');
    });
  });

  describe('importAccount', () => {
    it('imports from a recovery phrase and sets up the account', async () => {
      vi.mocked(validateRecoveryPhraseForImport).mockReturnValue(true);
      vi.mocked(loginWithRecoveryPhrase).mockResolvedValue(keys);
      vi.mocked(getCurrentAccount).mockResolvedValue(npub);

      await importAccount('word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12', '123456');

      expect(encryptAndSaveKey).toHaveBeenCalledWith(keys.private, '123456');
      expect(get(isAuthenticated)).toBe(true);
      expect(get(currentUser)).toEqual({ npub, pubkey: keys.public });
      expect(runPostLoginNetworkSync).toHaveBeenCalledWith(npub);
    });

    it('rejects an invalid recovery phrase', async () => {
      vi.mocked(validateRecoveryPhraseForImport).mockReturnValue(false);
      await expect(importAccount('bad phrase', '123456')).rejects.toThrow('Enter a valid 12- or 24-word recovery phrase');
    });
  });

  describe('unlockWithPin', () => {
    it('unlocks an existing account', async () => {
      vi.mocked(loadAndDecryptKey).mockResolvedValue(keys.private);
      vi.mocked(login).mockResolvedValue(keys);
      vi.mocked(getCurrentAccount).mockResolvedValue(npub);

      await unlockWithPin('123456');

      expect(login).toHaveBeenCalledWith(keys.private);
      expect(get(isAuthenticated)).toBe(true);
      expect(get(currentUser)).toEqual({ npub, pubkey: keys.public });
      expect(runPostLoginNetworkSync).toHaveBeenCalledWith(npub);
    });

    it('sets auth error on failure', async () => {
      vi.mocked(loadAndDecryptKey).mockRejectedValue(new Error('bad pin'));
      await expect(unlockWithPin('123456')).rejects.toThrow('bad pin');
      expect(get(authError)).toBe('bad pin');
    });
  });

  describe('logout', () => {
    it('clears auth state and invokes the backend logout', async () => {
      currentUser.set({ npub, pubkey: 'pk' });
      isAuthenticated.set(true);
      vi.mocked(invoke).mockResolvedValue(undefined);

      await logout();

      expect(get(isAuthenticated)).toBe(false);
      expect(get(currentUser)).toBeNull();
      expect(invoke).toHaveBeenCalledWith('logout');
      expect(clearAccountState).toHaveBeenCalledWith(npub);
    });

    it('sets auth error when logout fails but clears auth state', async () => {
      currentUser.set({ npub, pubkey: 'pk' });
      isAuthenticated.set(true);
      vi.mocked(invoke).mockRejectedValue(new Error('logout failed'));

      await expect(logout()).rejects.toThrow('logout failed');
      expect(get(isAuthenticated)).toBe(false);
      expect(get(currentUser)).toBeNull();
      expect(get(authError)).toBe('logout failed');
    });
  });

  describe('clearAuthError', () => {
    it('clears the auth error', () => {
      authError.set('oops');
      clearAuthError();
      expect(get(authError)).toBeNull();
    });
  });
});
