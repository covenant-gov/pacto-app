import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getBiometricStatus,
  hasBiometricUnlockData,
  getBiometricUnlockData,
  setBiometricUnlockData,
  removeBiometricUnlockData,
  authenticateBiometric,
  biometryLabel,
  mapBiometricErrorToI18nKey,
  isKeychainUnavailableError,
  canPersistBiometricUnlockData,
  BIOMETRIC_CAPABILITY_PROBE_NAME,
  BIOMETRIC_UNLOCK_DOMAIN,
  BiometryType,
} from './biometry';
import { checkStatus, authenticate, hasData, getData, setData, removeData } from '@choochmeque/tauri-plugin-biometry-api';

vi.mock('@choochmeque/tauri-plugin-biometry-api', () => ({
  BiometryType: { None: 0, Auto: 1, TouchID: 2, FaceID: 3, Iris: 4 },
  checkStatus: vi.fn(),
  authenticate: vi.fn(),
  hasData: vi.fn(),
  getData: vi.fn(),
  setData: vi.fn(),
  removeData: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(checkStatus).mockReset();
  vi.mocked(authenticate).mockReset();
  vi.mocked(hasData).mockReset();
  vi.mocked(getData).mockReset();
  vi.mocked(setData).mockReset();
  vi.mocked(removeData).mockReset();
});

describe('getBiometricStatus', () => {
  it('returns the underlying status on success', async () => {
    vi.mocked(checkStatus).mockResolvedValue({ isAvailable: true, biometryType: BiometryType.TouchID });

    const status = await getBiometricStatus();

    expect(status).toEqual({ isAvailable: true, biometryType: BiometryType.TouchID });
  });

  it('swallows a thrown checkStatus() and reports unavailable (Linux / unsupported)', async () => {
    vi.mocked(checkStatus).mockRejectedValue(new Error('platform not supported'));

    const status = await getBiometricStatus();

    expect(status.isAvailable).toBe(false);
    expect(status.biometryType).toBe(BiometryType.None);
    expect(status.error).toBe('platform not supported');
  });
});

describe('biometryLabel', () => {
  it('maps TouchID to touchId', () => {
    expect(biometryLabel(BiometryType.TouchID)).toBe('touchId');
  });

  it('maps Auto to windowsHello', () => {
    expect(biometryLabel(BiometryType.Auto)).toBe('windowsHello');
  });

  it('maps FaceID to generic', () => {
    expect(biometryLabel(BiometryType.FaceID)).toBe('generic');
  });

  it('maps Iris to generic', () => {
    expect(biometryLabel(BiometryType.Iris)).toBe('generic');
  });

  it('maps None to generic', () => {
    expect(biometryLabel(BiometryType.None)).toBe('generic');
  });
});

describe('mapBiometricErrorToI18nKey', () => {
  it('maps userCancel errors to the cancelled key', () => {
    expect(mapBiometricErrorToI18nKey(new Error('userCancel'))).toBe('auth.biometricErrorCancelled');
  });

  it('maps biometryLockout errors to the locked-out key', () => {
    expect(mapBiometricErrorToI18nKey(new Error('biometryLockout'))).toBe('auth.biometricErrorLockedOut');
  });

  it('maps biometryNotAvailable errors to the unavailable key', () => {
    expect(mapBiometricErrorToI18nKey(new Error('biometryNotAvailable'))).toBe('auth.biometricErrorUnavailable');
  });

  it('maps biometryNotEnrolled errors to the unavailable key', () => {
    expect(mapBiometricErrorToI18nKey(new Error('biometryNotEnrolled'))).toBe('auth.biometricErrorUnavailable');
  });

  it('maps notSupported errors to the unavailable key', () => {
    expect(mapBiometricErrorToI18nKey(new Error('notSupported'))).toBe('auth.biometricErrorUnavailable');
  });

  it('maps passcodeNotSet errors to the unavailable key', () => {
    expect(mapBiometricErrorToI18nKey(new Error('passcodeNotSet'))).toBe('auth.biometricErrorUnavailable');
  });

  it('maps unrecognized errors to the generic key', () => {
    expect(mapBiometricErrorToI18nKey(new Error('something else entirely'))).toBe('auth.biometricErrorGeneric');
  });

  it('maps non-Error thrown values to the generic key', () => {
    expect(mapBiometricErrorToI18nKey('systemCancel')).toBe('auth.biometricErrorGeneric');
  });
});

describe('isKeychainUnavailableError', () => {
  it('detects the macOS unsigned-build keychain failure', () => {
    expect(
      isKeychainUnavailableError(new Error('[keychainError] - Error adding item to keychain: -34018'))
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isKeychainUnavailableError(new Error('KeychainError'))).toBe(true);
  });

  it('does not flag unrelated errors', () => {
    expect(isKeychainUnavailableError(new Error('userCancel'))).toBe(false);
  });

  it('does not flag non-Error thrown values matching nothing', () => {
    expect(isKeychainUnavailableError('systemCancel')).toBe(false);
  });
});

describe('hasBiometricUnlockData', () => {
  it('returns the underlying result on success', async () => {
    vi.mocked(hasData).mockResolvedValue(true);

    expect(await hasBiometricUnlockData('npub1test')).toBe(true);
  });

  it('returns false on a thrown hasData() rather than propagating', async () => {
    vi.mocked(hasData).mockRejectedValue(new Error('denied'));

    await expect(hasBiometricUnlockData('npub1test')).resolves.toBe(false);
  });
});

describe('canPersistBiometricUnlockData', () => {
  it('round-trips a disposable probe entry and returns true on success', async () => {
    vi.mocked(setData).mockResolvedValue(undefined);
    vi.mocked(removeData).mockResolvedValue(undefined);

    await expect(canPersistBiometricUnlockData()).resolves.toBe(true);

    expect(setData).toHaveBeenCalledWith({
      domain: BIOMETRIC_UNLOCK_DOMAIN,
      name: BIOMETRIC_CAPABILITY_PROBE_NAME,
      data: 'probe',
    });
    expect(removeData).toHaveBeenCalledWith({
      domain: BIOMETRIC_UNLOCK_DOMAIN,
      name: BIOMETRIC_CAPABILITY_PROBE_NAME,
    });
  });

  it('returns false when the probe write fails (e.g. unsigned-build keychainError), without attempting cleanup', async () => {
    vi.mocked(setData).mockRejectedValue(new Error('[keychainError] - Error adding item to keychain: -34018'));

    await expect(canPersistBiometricUnlockData()).resolves.toBe(false);

    expect(removeData).not.toHaveBeenCalled();
  });

  it('still returns true when the probe write succeeds but cleanup fails', async () => {
    vi.mocked(setData).mockResolvedValue(undefined);
    vi.mocked(removeData).mockRejectedValue(new Error('itemNotFound'));

    await expect(canPersistBiometricUnlockData()).resolves.toBe(true);
  });
});

describe('setBiometricUnlockData', () => {
  it('forwards domain, npub, and data to the plugin', async () => {
    vi.mocked(setData).mockResolvedValue(undefined);

    await setBiometricUnlockData('npub1test', 'deadbeef');

    expect(setData).toHaveBeenCalledWith({ domain: BIOMETRIC_UNLOCK_DOMAIN, name: 'npub1test', data: 'deadbeef' });
  });

  it('lets a rejection propagate', async () => {
    vi.mocked(setData).mockRejectedValue(new Error('denied'));

    await expect(setBiometricUnlockData('npub1test', 'deadbeef')).rejects.toThrow('denied');
  });
});

describe('getBiometricUnlockData', () => {
  it('forwards domain, npub, and reason, and unwraps response.data', async () => {
    vi.mocked(getData).mockResolvedValue({ domain: BIOMETRIC_UNLOCK_DOMAIN, name: 'npub1test', data: 'deadbeef' });

    await expect(getBiometricUnlockData('npub1test', 'Unlock Pacto')).resolves.toBe('deadbeef');

    expect(getData).toHaveBeenCalledWith({ domain: BIOMETRIC_UNLOCK_DOMAIN, name: 'npub1test', reason: 'Unlock Pacto' });
  });

  it('lets a rejection (e.g. user cancel) propagate', async () => {
    vi.mocked(getData).mockRejectedValue(new Error('[userCancel] - user cancelled'));

    await expect(getBiometricUnlockData('npub1test', 'Unlock Pacto')).rejects.toThrow('[userCancel]');
  });
});

describe('removeBiometricUnlockData', () => {
  it('forwards domain and npub to the plugin', async () => {
    vi.mocked(removeData).mockResolvedValue(undefined);

    await removeBiometricUnlockData('npub1test');

    expect(removeData).toHaveBeenCalledWith({ domain: BIOMETRIC_UNLOCK_DOMAIN, name: 'npub1test' });
  });

  it('lets a rejection propagate', async () => {
    vi.mocked(removeData).mockRejectedValue(new Error('not found'));

    await expect(removeBiometricUnlockData('npub1test')).rejects.toThrow('not found');
  });
});

describe('authenticateBiometric', () => {
  it('forwards the reason to the plugin', async () => {
    vi.mocked(authenticate).mockResolvedValue(undefined);

    await authenticateBiometric('Unlock Pacto');

    expect(authenticate).toHaveBeenCalledWith('Unlock Pacto');
  });

  it('lets a rejection (e.g. user cancel) propagate', async () => {
    vi.mocked(authenticate).mockRejectedValue(new Error('[userCancel] - user cancelled'));

    await expect(authenticateBiometric('Unlock Pacto')).rejects.toThrow('[userCancel]');
  });
});
