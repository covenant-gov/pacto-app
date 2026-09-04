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
  unlockWithBiometrics,
  logout,
  clearAuthError,
  checkSession,
  sessionHeartbeat,
  dropSessionState,
  maybeRequireSession,
  initSessionFocusChecks,
  migrationCompleteToast,
  showMigrationCompleteToast,
} from './auth';
import {
  login,
  loginWithRecoveryPhrase,
  createAccount as apiCreateAccount,
  connect,
  checkAnyAccountExists,
  getCurrentAccount,
  checkSession as apiCheckSession,
  sessionHeartbeat as apiSessionHeartbeat,
  unlockWithBiometricKey,
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
import {
  backupVerified,
  backupVerificationModalOpen,
} from './backup-verification';
import { awaitGateBeforeAuth, freezeGate } from '../lib/updater/update-gate';
import { getBiometricUnlockData, removeBiometricUnlockData } from '../lib/api/biometry';
import { biometricUnlockEnabled } from './biometric-unlock';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../lib/updater/update-gate', () => ({
  awaitGateBeforeAuth: vi.fn(),
  freezeGate: vi.fn(),
}));

vi.mock('../lib/api/auth', () => ({
  login: vi.fn(),
  loginWithRecoveryPhrase: vi.fn(),
  createAccount: vi.fn(),
  connect: vi.fn(),
  checkAnyAccountExists: vi.fn(),
  getCurrentAccount: vi.fn(),
  checkSession: vi.fn(),
  sessionHeartbeat: vi.fn(),
  unlockWithBiometricKey: vi.fn(),
}));

vi.mock('../lib/api/biometry', () => ({
  getBiometricUnlockData: vi.fn(),
  removeBiometricUnlockData: vi.fn(),
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
    public: 'npub1test',
    pubkey_hex: 'aa'.repeat(32),
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
    vi.mocked(apiCheckSession).mockReset();
    vi.mocked(apiSessionHeartbeat).mockReset();
    vi.mocked(invoke).mockReset();
    vi.mocked(awaitGateBeforeAuth).mockReset().mockResolvedValue('clear');
    vi.mocked(freezeGate).mockReset();
    vi.mocked(unlockWithBiometricKey).mockReset();
    vi.mocked(getBiometricUnlockData).mockReset();
    vi.mocked(removeBiometricUnlockData).mockReset();
    biometricUnlockEnabled.set(false);
    backupVerified.set(null);
    backupVerificationModalOpen.set(false);
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

  describe('checkSession', () => {
    it('returns unlocked=true when the backend session is open', async () => {
      vi.mocked(apiCheckSession).mockResolvedValue({ unlocked: true });
      const status = await checkSession();
      expect(status).toEqual({ unlocked: true });
      expect(apiCheckSession).toHaveBeenCalledTimes(1);
    });

    it('returns unlocked=false and drops auth state when the backend reports locked', async () => {
      currentUser.set({ npub, pubkey: 'pk' });
      isAuthenticated.set(true);
      vi.mocked(apiCheckSession).mockResolvedValue({ unlocked: false, lockedAt: 1234567890 });

      const status = await checkSession();

      expect(status).toEqual({ unlocked: false, lockedAt: 1234567890 });
      expect(get(isAuthenticated)).toBe(false);
      expect(get(currentUser)).toBeNull();
    });

    it('treats an error as locked and drops auth state', async () => {
      currentUser.set({ npub, pubkey: 'pk' });
      isAuthenticated.set(true);
      vi.mocked(apiCheckSession).mockRejectedValue(new Error('ipc failed'));

      const status = await checkSession();

      expect(status).toEqual({ unlocked: false });
      expect(get(isAuthenticated)).toBe(false);
      expect(get(currentUser)).toBeNull();
    });
  });

  describe('sessionHeartbeat', () => {
    it('calls the backend heartbeat', async () => {
      vi.mocked(apiSessionHeartbeat).mockResolvedValue(undefined);
      await sessionHeartbeat();
      expect(apiSessionHeartbeat).toHaveBeenCalledTimes(1);
    });

    it('does not throw when the backend call fails', async () => {
      vi.mocked(apiSessionHeartbeat).mockRejectedValue(new Error('ipc failed'));
      await expect(sessionHeartbeat()).resolves.toBeUndefined();
    });
  });

  describe('dropSessionState', () => {
    it('clears auth state', () => {
      currentUser.set({ npub, pubkey: 'pk' });
      isAuthenticated.set(true);
      dropSessionState();
      expect(get(isAuthenticated)).toBe(false);
      expect(get(currentUser)).toBeNull();
    });
  });

  describe('maybeRequireSession', () => {
    it('returns true when the session is unlocked', async () => {
      vi.mocked(apiCheckSession).mockResolvedValue({ unlocked: true });
      await expect(maybeRequireSession()).resolves.toBe(true);
    });

    it('returns false and drops auth state when the session is locked', async () => {
      currentUser.set({ npub, pubkey: 'pk' });
      isAuthenticated.set(true);
      vi.mocked(apiCheckSession).mockResolvedValue({ unlocked: false });
      const ok = await maybeRequireSession();
      expect(ok).toBe(false);
      expect(get(isAuthenticated)).toBe(false);
      expect(get(currentUser)).toBeNull();
    });
  });

  describe('sessionStorage unlock flag', () => {
    it('is not set after createAccount', async () => {
      const setItem = vi.fn();
      vi.stubGlobal('sessionStorage', { setItem, removeItem: vi.fn(), getItem: vi.fn() });
      vi.mocked(apiCreateAccount).mockResolvedValue(keys);
      vi.mocked(getCurrentAccount).mockResolvedValue(npub);

      await createAccount('123456');

      expect(setItem).not.toHaveBeenCalledWith('pacto_session_unlocked', expect.any(String));
      vi.unstubAllGlobals();
    });

    it('is not set after unlockWithPin', async () => {
      const setItem = vi.fn();
      vi.stubGlobal('sessionStorage', { setItem, removeItem: vi.fn(), getItem: vi.fn() });
      vi.mocked(loadAndDecryptKey).mockResolvedValue(keys.private);
      vi.mocked(login).mockResolvedValue(keys);
      vi.mocked(getCurrentAccount).mockResolvedValue(npub);

      await unlockWithPin('123456');

      expect(setItem).not.toHaveBeenCalledWith('pacto_session_unlocked', expect.any(String));
      vi.unstubAllGlobals();
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
      expect(get(currentUser)).toEqual({ npub, pubkey: keys.pubkey_hex });
      expect(get(activeTopNavTab)).toBe(DEFAULT_TOP_NAV_TAB);
      expect(loadAccountState).toHaveBeenCalledWith(npub);
      expect(runPostLoginNetworkSync).toHaveBeenCalledWith(npub);
      expect(get(backupVerified)).toBe(false);
    });

    it('sets auth error on failure', async () => {
      vi.mocked(apiCreateAccount).mockRejectedValue(new Error('key gen failed'));
      await expect(createAccount('123456')).rejects.toThrow('key gen failed');
      expect(get(authError)).toBe('key gen failed');
    });

    it('freezes the gate exactly once on success', async () => {
      vi.mocked(apiCreateAccount).mockResolvedValue(keys);
      vi.mocked(getCurrentAccount).mockResolvedValue(npub);

      await createAccount('123456');

      expect(freezeGate).toHaveBeenCalledTimes(1);
    });

    it('does not authenticate and issues no backend call when the gate is blocked', async () => {
      vi.mocked(awaitGateBeforeAuth).mockResolvedValue('blocked');

      await createAccount('123456');

      expect(get(isAuthenticated)).toBe(false);
      expect(get(currentUser)).toBeNull();
      expect(apiCreateAccount).not.toHaveBeenCalled();
      expect(encryptAndSaveKey).not.toHaveBeenCalled();
      expect(runPostLoginNetworkSync).not.toHaveBeenCalled();
      expect(freezeGate).not.toHaveBeenCalled();
      expect(get(authLoading)).toBe(false);
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
      expect(get(currentUser)).toEqual({ npub, pubkey: keys.pubkey_hex });
      expect(runPostLoginNetworkSync).toHaveBeenCalledWith(npub);
      expect(get(backupVerified)).toBe(true);
      expect(get(backupVerificationModalOpen)).toBe(false);
    });

    it('rejects an invalid recovery phrase', async () => {
      vi.mocked(validateRecoveryPhraseForImport).mockReturnValue(false);
      await expect(importAccount('bad phrase', '123456')).rejects.toThrow('Enter a valid 12- or 24-word recovery phrase');
    });

    it('freezes the gate exactly once on success', async () => {
      vi.mocked(validateRecoveryPhraseForImport).mockReturnValue(true);
      vi.mocked(loginWithRecoveryPhrase).mockResolvedValue(keys);
      vi.mocked(getCurrentAccount).mockResolvedValue(npub);

      await importAccount('word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12', '123456');

      expect(freezeGate).toHaveBeenCalledTimes(1);
    });

    it('does not authenticate and issues no backend call when the gate is blocked', async () => {
      vi.mocked(awaitGateBeforeAuth).mockResolvedValue('blocked');

      await importAccount('word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12', '123456');

      expect(get(isAuthenticated)).toBe(false);
      expect(get(currentUser)).toBeNull();
      expect(loginWithRecoveryPhrase).not.toHaveBeenCalled();
      expect(encryptAndSaveKey).not.toHaveBeenCalled();
      expect(runPostLoginNetworkSync).not.toHaveBeenCalled();
      expect(freezeGate).not.toHaveBeenCalled();
      expect(get(authLoading)).toBe(false);
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
      expect(get(currentUser)).toEqual({ npub, pubkey: keys.pubkey_hex });
      expect(runPostLoginNetworkSync).toHaveBeenCalledWith(npub);
      expect(get(backupVerified)).toBe(null);
      expect(get(backupVerificationModalOpen)).toBe(false);
    });

    it('sets auth error on failure', async () => {
      vi.mocked(loadAndDecryptKey).mockRejectedValue(new Error('bad pin'));
      await expect(unlockWithPin('123456')).rejects.toThrow('bad pin');
      expect(get(authError)).toBe('bad pin');
    });

    it('freezes the gate exactly once on success', async () => {
      vi.mocked(loadAndDecryptKey).mockResolvedValue(keys.private);
      vi.mocked(login).mockResolvedValue(keys);
      vi.mocked(getCurrentAccount).mockResolvedValue(npub);

      await unlockWithPin('123456');

      expect(freezeGate).toHaveBeenCalledTimes(1);
    });

    it('does not authenticate and issues no backend call when the gate is blocked', async () => {
      vi.mocked(awaitGateBeforeAuth).mockResolvedValue('blocked');

      await unlockWithPin('123456');

      expect(get(isAuthenticated)).toBe(false);
      expect(get(currentUser)).toBeNull();
      expect(loadAndDecryptKey).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();
      expect(runPostLoginNetworkSync).not.toHaveBeenCalled();
      expect(freezeGate).not.toHaveBeenCalled();
      expect(get(authLoading)).toBe(false);
    });
  });

  describe('unlockWithBiometrics', () => {
    it('unlocks an existing account via biometric key material', async () => {
      vi.mocked(getBiometricUnlockData).mockResolvedValue('deadbeef');
      vi.mocked(unlockWithBiometricKey).mockResolvedValue(keys);
      vi.mocked(getCurrentAccount).mockResolvedValue(npub);

      await unlockWithBiometrics(npub);

      expect(getBiometricUnlockData).toHaveBeenCalledWith(npub, 'Unlock Pacto');
      expect(unlockWithBiometricKey).toHaveBeenCalledWith('deadbeef');
      expect(get(isAuthenticated)).toBe(true);
      expect(get(currentUser)).toEqual({ npub, pubkey: keys.pubkey_hex });
      expect(runPostLoginNetworkSync).toHaveBeenCalledWith(npub);
      expect(freezeGate).toHaveBeenCalledTimes(1);
    });

    it('on a stale-key rejection from the backend, revokes the enrollment, sets auth error, and rethrows', async () => {
      biometricUnlockEnabled.set(true);
      vi.mocked(getBiometricUnlockData).mockResolvedValue('deadbeef');
      // Tauri rejects `invoke` with the deserialized `Err` payload -- a plain string, not an
      // `Error` instance, matching the actual backend rejection shape for this command.
      vi.mocked(unlockWithBiometricKey).mockRejectedValue(
        'Biometric key material is no longer valid. Use your PIN.'
      );
      vi.mocked(removeBiometricUnlockData).mockResolvedValue(undefined);

      await expect(unlockWithBiometrics(npub)).rejects.toBe(
        'Biometric key material is no longer valid. Use your PIN.'
      );

      expect(get(authError)).toBe('Biometric key material is no longer valid. Use your PIN.');
      expect(get(isAuthenticated)).toBe(false);
      await Promise.resolve();
      expect(removeBiometricUnlockData).toHaveBeenCalledWith(npub);
      expect(get(biometricUnlockEnabled)).toBe(false);
    });

    it('on a cancelled OS prompt, leaves a valid enrollment intact', async () => {
      biometricUnlockEnabled.set(true);
      vi.mocked(getBiometricUnlockData).mockRejectedValue('[userCancel] - user cancelled');

      await expect(unlockWithBiometrics(npub)).rejects.toBe('[userCancel] - user cancelled');

      expect(get(authError)).toBe('[userCancel] - user cancelled');
      expect(get(isAuthenticated)).toBe(false);
      expect(unlockWithBiometricKey).not.toHaveBeenCalled();
      expect(removeBiometricUnlockData).not.toHaveBeenCalled();
      expect(get(biometricUnlockEnabled)).toBe(true);
    });

    it('when getCurrentAccount rejects after a valid key unlock, leaves the enrollment intact', async () => {
      biometricUnlockEnabled.set(true);
      vi.mocked(getBiometricUnlockData).mockResolvedValue('deadbeef');
      vi.mocked(unlockWithBiometricKey).mockResolvedValue(keys);
      vi.mocked(getCurrentAccount).mockRejectedValue('backend unavailable');

      await expect(unlockWithBiometrics(npub)).rejects.toBe('backend unavailable');

      expect(get(isAuthenticated)).toBe(false);
      expect(get(currentUser)).toBeNull();
      expect(removeBiometricUnlockData).not.toHaveBeenCalled();
      expect(get(biometricUnlockEnabled)).toBe(true);
    });

    it('does not authenticate and issues no backend call when the gate is blocked', async () => {
      vi.mocked(awaitGateBeforeAuth).mockResolvedValue('blocked');

      await unlockWithBiometrics(npub);

      expect(get(isAuthenticated)).toBe(false);
      expect(get(currentUser)).toBeNull();
      expect(getBiometricUnlockData).not.toHaveBeenCalled();
      expect(unlockWithBiometricKey).not.toHaveBeenCalled();
      expect(freezeGate).not.toHaveBeenCalled();
      expect(get(authLoading)).toBe(false);
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

  describe('initSessionFocusChecks', () => {
    let focusHandler: (() => void) | null = null;
    let visibilityHandler: (() => void) | null = null;
    const windowAddEventListener = vi.fn((event: string, handler: () => void) => {
      if (event === 'focus') focusHandler = handler;
    });
    const windowRemoveEventListener = vi.fn();
    const documentAddEventListener = vi.fn((event: string, handler: () => void) => {
      if (event === 'visibilitychange') visibilityHandler = handler;
    });
    const documentRemoveEventListener = vi.fn();
    let cleanup: (() => void) | undefined;
    let docStub: {
      visibilityState: string;
      addEventListener: typeof documentAddEventListener;
      removeEventListener: typeof documentRemoveEventListener;
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.mocked(apiCheckSession).mockResolvedValue({ unlocked: true });
      vi.stubGlobal('window', {
        addEventListener: windowAddEventListener,
        removeEventListener: windowRemoveEventListener,
      } as unknown as Window);
      docStub = {
        visibilityState: 'hidden',
        addEventListener: documentAddEventListener,
        removeEventListener: documentRemoveEventListener,
      };
      vi.stubGlobal('document', docStub as unknown as Document);
    });

    afterEach(() => {
      cleanup?.();
      cleanup = undefined;
      focusHandler = null;
      visibilityHandler = null;
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it('registers focus and visibilitychange listeners', () => {
      cleanup = initSessionFocusChecks();
      expect(windowAddEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
      expect(documentAddEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });

    it('calls checkSession on window focus', async () => {
      cleanup = initSessionFocusChecks();
      expect(focusHandler).toBeTruthy();
      focusHandler?.();
      expect(apiCheckSession).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(50);
      expect(apiCheckSession).toHaveBeenCalledTimes(1);
    });

    it('calls checkSession when document becomes visible', async () => {
      cleanup = initSessionFocusChecks();
      docStub.visibilityState = 'visible';
      expect(visibilityHandler).toBeTruthy();
      visibilityHandler?.();
      expect(apiCheckSession).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(50);
      expect(apiCheckSession).toHaveBeenCalledTimes(1);
    });

    it('does not call checkSession when document stays hidden', async () => {
      cleanup = initSessionFocusChecks();
      docStub.visibilityState = 'hidden';
      expect(visibilityHandler).toBeTruthy();
      visibilityHandler?.();
      await vi.advanceTimersByTimeAsync(50);
      expect(apiCheckSession).not.toHaveBeenCalled();
    });

    it('removes listeners on cleanup', () => {
      cleanup = initSessionFocusChecks();
      cleanup();
      expect(windowRemoveEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
      expect(documentRemoveEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });
  });

  describe('migrationCompleteToast', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      migrationCompleteToast.set(null);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows the migration-complete toast for 5 seconds', () => {
      expect(get(migrationCompleteToast)).toBeNull();
      showMigrationCompleteToast('Account security updated');
      expect(get(migrationCompleteToast)).toEqual({
        shown: true,
        message: 'Account security updated',
      });
      vi.advanceTimersByTime(5000);
      expect(get(migrationCompleteToast)).toBeNull();
    });
  });
});
