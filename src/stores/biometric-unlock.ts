import { writable, get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { persistenceKey, setCurrentNpubForPersistence } from './persistence-context';
import { exportEncryptionKeyMaterial, getCurrentAccount } from '../lib/api/auth';
import {
  getBiometricStatus,
  hasBiometricUnlockData,
  authenticateBiometric,
  setBiometricUnlockData,
  removeBiometricUnlockData,
  biometryLabel,
  type BiometryLabel,
} from '../lib/api/biometry';

export const BIOMETRIC_UNLOCK_PREFIX = 'pacto_biometric_unlock_enabled_v1';

/** Per-npub user preference: "I opted into biometric unlock". */
export const biometricUnlockEnabled = writable<boolean>(false);

function persistBiometricUnlockEnabled(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(BIOMETRIC_UNLOCK_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function loadBiometricUnlockPreference(npub: string): void {
  setCurrentNpubForPersistence(npub);
  if (typeof localStorage === 'undefined') {
    biometricUnlockEnabled.set(false);
    return;
  }
  const key = persistenceKey(BIOMETRIC_UNLOCK_PREFIX);
  if (!key) {
    biometricUnlockEnabled.set(false);
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      biometricUnlockEnabled.set(false);
      return;
    }
    const parsed = JSON.parse(raw);
    biometricUnlockEnabled.set(typeof parsed === 'boolean' ? parsed : false);
  } catch {
    biometricUnlockEnabled.set(false);
  }
}

biometricUnlockEnabled.subscribe((value) => {
  persistBiometricUnlockEnabled(value);
});

/**
 * Opt into biometric unlock: authenticate, export the current session key,
 * and store it in OS biometric-gated storage. Only flips the store to
 * `true` on full success; any failure propagates and leaves the store
 * unchanged.
 */
export async function enrollBiometricUnlock(npub: string): Promise<void> {
  const status = await getBiometricStatus();
  if (!status.isAvailable) {
    throw new Error('Biometric unlock is not available on this device.');
  }
  await authenticateBiometric(get(t)('settings.biometricUnlockEnrollReason'));
  const keyHex = await exportEncryptionKeyMaterial();
  // The biometric prompt above is a long interactive await; guard against a mid-flight
  // account switch writing this session's key material under a different npub's entry.
  if ((await getCurrentAccount()) !== npub) {
    throw new Error('Account changed during biometric enrollment.');
  }
  await setBiometricUnlockData(npub, keyHex);
  biometricUnlockEnabled.set(true);
}

/**
 * Opt out of biometric unlock: revoke the stored secret first, then flip the
 * store. If revocation fails, the error propagates and the store is left
 * unchanged so the UI never claims a revoke that didn't happen.
 */
export async function disableBiometricUnlock(npub: string): Promise<void> {
  await removeBiometricUnlockData(npub);
  biometricUnlockEnabled.set(false);
}

export interface BiometricAvailability {
  available: boolean;
  label: BiometryLabel;
}

/**
 * Live ground-truth check for the pre-login PIN-unlock screen, which can't
 * rely on the persisted preference (npub-scoped localStorage normally only
 * set after login).
 */
export async function canOfferBiometricUnlock(npub: string): Promise<BiometricAvailability> {
  try {
    const [status, hasData] = await Promise.all([getBiometricStatus(), hasBiometricUnlockData(npub)]);
    return { available: status.isAvailable && hasData, label: biometryLabel(status.biometryType) };
  } catch {
    return { available: false, label: 'generic' };
  }
}
