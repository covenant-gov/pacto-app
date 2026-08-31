import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  biometricUnlockEnabled,
  loadBiometricUnlockPreference,
  enrollBiometricUnlock,
  disableBiometricUnlock,
  canOfferBiometricUnlock,
  BIOMETRIC_UNLOCK_PREFIX,
} from './biometric-unlock';
import { setCurrentNpubForPersistence } from './persistence-context';
import {
  getBiometricStatus,
  hasBiometricUnlockData,
  authenticateBiometric,
  setBiometricUnlockData,
  removeBiometricUnlockData,
  BiometryType,
} from '../lib/api/biometry';
import { exportEncryptionKeyMaterial, getCurrentAccount } from '../lib/api/auth';

vi.mock('../lib/api/biometry', () => ({
  getBiometricStatus: vi.fn(),
  hasBiometricUnlockData: vi.fn(),
  authenticateBiometric: vi.fn(),
  setBiometricUnlockData: vi.fn(),
  removeBiometricUnlockData: vi.fn(),
  biometryLabel: (type: number) => (type === 2 ? 'touchId' : type === 1 ? 'windowsHello' : 'generic'),
  BiometryType: { None: 0, Auto: 1, TouchID: 2, FaceID: 3, Iris: 4 },
}));

vi.mock('../lib/api/auth', () => ({
  exportEncryptionKeyMaterial: vi.fn(),
  getCurrentAccount: vi.fn(),
}));

const NPUB = 'npub1test';

function expectedKey(npub: string = NPUB): string {
  return `${BIOMETRIC_UNLOCK_PREFIX}_${npub}`;
}

beforeEach(() => {
  const storage: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem(key: string): string | null {
      return storage[key] ?? null;
    },
    setItem(key: string, value: string): void {
      storage[key] = value;
    },
    removeItem(key: string): void {
      delete storage[key];
    },
  });
  setCurrentNpubForPersistence(null);
  biometricUnlockEnabled.set(false);
  vi.mocked(getBiometricStatus).mockReset();
  vi.mocked(hasBiometricUnlockData).mockReset();
  vi.mocked(authenticateBiometric).mockReset();
  vi.mocked(setBiometricUnlockData).mockReset();
  vi.mocked(removeBiometricUnlockData).mockReset();
  vi.mocked(exportEncryptionKeyMaterial).mockReset();
  vi.mocked(getCurrentAccount).mockReset().mockResolvedValue(NPUB);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentNpubForPersistence(null);
  biometricUnlockEnabled.set(false);
  vi.clearAllMocks();
});

describe('biometricUnlockEnabled persistence', () => {
  it('defaults to false when no persisted value exists', () => {
    loadBiometricUnlockPreference(NPUB);
    expect(get(biometricUnlockEnabled)).toBe(false);
  });

  it('reads true from localStorage when previously enabled', () => {
    localStorage.setItem(expectedKey(), JSON.stringify(true));
    loadBiometricUnlockPreference(NPUB);
    expect(get(biometricUnlockEnabled)).toBe(true);
  });

  it('reads false from localStorage when previously disabled', () => {
    localStorage.setItem(expectedKey(), JSON.stringify(false));
    loadBiometricUnlockPreference(NPUB);
    expect(get(biometricUnlockEnabled)).toBe(false);
  });

  it('treats corrupt values as false', () => {
    localStorage.setItem(expectedKey(), 'not-json');
    loadBiometricUnlockPreference(NPUB);
    expect(get(biometricUnlockEnabled)).toBe(false);
  });

  it('persists true per npub', async () => {
    loadBiometricUnlockPreference(NPUB);
    biometricUnlockEnabled.set(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(localStorage.getItem(expectedKey())).toBe('true');
  });

  it('does not leak the previous account preference across a switch', () => {
    loadBiometricUnlockPreference(NPUB);
    biometricUnlockEnabled.set(true);

    const otherNpub = 'npub1other';
    loadBiometricUnlockPreference(otherNpub);
    // otherNpub has no persisted value yet: must not inherit NPUB's `true`.
    expect(get(biometricUnlockEnabled)).toBe(false);

    expect(localStorage.getItem(expectedKey(NPUB))).toBe('true');
    expect(localStorage.getItem(expectedKey(otherNpub))).toBe('false');
  });
});

describe('enrollBiometricUnlock', () => {
  it('happy path authenticates, exports the key, stores it, and enables the preference in order', async () => {
    vi.mocked(getBiometricStatus).mockResolvedValue({ isAvailable: true, biometryType: BiometryType.TouchID });

    const calls: string[] = [];
    vi.mocked(authenticateBiometric).mockImplementation(async () => {
      calls.push('authenticate');
    });
    vi.mocked(exportEncryptionKeyMaterial).mockImplementation(async () => {
      calls.push('export');
      return 'deadbeef';
    });
    vi.mocked(setBiometricUnlockData).mockImplementation(async () => {
      calls.push('setData');
    });

    await enrollBiometricUnlock(NPUB);

    expect(calls).toEqual(['authenticate', 'export', 'setData']);
    expect(setBiometricUnlockData).toHaveBeenCalledWith(NPUB, 'deadbeef');
    expect(get(biometricUnlockEnabled)).toBe(true);
  });

  it('throws and leaves the store false when unavailable, without authenticating', async () => {
    vi.mocked(getBiometricStatus).mockResolvedValue({ isAvailable: false, biometryType: BiometryType.None });

    await expect(enrollBiometricUnlock(NPUB)).rejects.toThrow();

    expect(authenticateBiometric).not.toHaveBeenCalled();
    expect(get(biometricUnlockEnabled)).toBe(false);
  });

  it('rejects and does not store the key when the account changes during enrollment', async () => {
    vi.mocked(getBiometricStatus).mockResolvedValue({ isAvailable: true, biometryType: BiometryType.TouchID });
    vi.mocked(authenticateBiometric).mockResolvedValue(undefined);
    vi.mocked(exportEncryptionKeyMaterial).mockResolvedValue('deadbeef');
    vi.mocked(getCurrentAccount).mockResolvedValue('npub1someoneelse');

    await expect(enrollBiometricUnlock(NPUB)).rejects.toThrow('Account changed during biometric enrollment.');

    expect(setBiometricUnlockData).not.toHaveBeenCalled();
    expect(get(biometricUnlockEnabled)).toBe(false);
  });
});

describe('disableBiometricUnlock', () => {
  it('happy path removes stored data and disables the preference', async () => {
    biometricUnlockEnabled.set(true);
    vi.mocked(removeBiometricUnlockData).mockResolvedValue(undefined);

    await disableBiometricUnlock(NPUB);

    expect(removeBiometricUnlockData).toHaveBeenCalledWith(NPUB);
    expect(get(biometricUnlockEnabled)).toBe(false);
  });

  it('propagates the error and leaves the store true when removal fails (revoke must actually happen)', async () => {
    biometricUnlockEnabled.set(true);
    vi.mocked(removeBiometricUnlockData).mockRejectedValue(new Error('keychain busy'));

    await expect(disableBiometricUnlock(NPUB)).rejects.toThrow('keychain busy');

    expect(get(biometricUnlockEnabled)).toBe(true);
  });
});

describe('canOfferBiometricUnlock', () => {
  it('is available only when both status and stored data are true', async () => {
    vi.mocked(getBiometricStatus).mockResolvedValue({ isAvailable: true, biometryType: BiometryType.TouchID });
    vi.mocked(hasBiometricUnlockData).mockResolvedValue(true);

    await expect(canOfferBiometricUnlock(NPUB)).resolves.toEqual({ available: true, label: 'touchId' });
  });

  it('is unavailable when status reports unavailable even if data exists', async () => {
    vi.mocked(getBiometricStatus).mockResolvedValue({ isAvailable: false, biometryType: BiometryType.None });
    vi.mocked(hasBiometricUnlockData).mockResolvedValue(true);

    await expect(canOfferBiometricUnlock(NPUB)).resolves.toEqual({ available: false, label: 'generic' });
  });

  it('is unavailable when no data is stored even if status is available', async () => {
    vi.mocked(getBiometricStatus).mockResolvedValue({ isAvailable: true, biometryType: BiometryType.Auto });
    vi.mocked(hasBiometricUnlockData).mockResolvedValue(false);

    await expect(canOfferBiometricUnlock(NPUB)).resolves.toEqual({ available: false, label: 'windowsHello' });
  });
});
