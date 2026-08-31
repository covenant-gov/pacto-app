import {
  BiometryType,
  checkStatus,
  authenticate,
  hasData,
  getData,
  setData,
  removeData,
} from '@choochmeque/tauri-plugin-biometry-api';
import type { Status } from '@choochmeque/tauri-plugin-biometry-api';

export { BiometryType };
export type { Status };

/** Fixed domain scoping every biometric-unlock secret; must match the Tauri capability. */
export const BIOMETRIC_UNLOCK_DOMAIN = 'io.pacto.biometric-unlock';

/**
 * Availability of biometric auth on this device. Never throws: the Tauri
 * capability denies every biometry command outright on Linux, so any
 * rejection (including a plain unsupported-platform error) degrades to
 * unavailable instead of propagating.
 */
export async function getBiometricStatus(): Promise<Status> {
  try {
    return await checkStatus();
  } catch (error) {
    return {
      isAvailable: false,
      biometryType: BiometryType.None,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Prompt the OS biometric dialog. Lets rejections propagate; caller handles. */
export async function authenticateBiometric(reason: string): Promise<void> {
  await authenticate(reason);
}

/** Whether biometric-unlock key material is already stored for this npub. Never throws. */
export async function hasBiometricUnlockData(npub: string): Promise<boolean> {
  try {
    return await hasData({ domain: BIOMETRIC_UNLOCK_DOMAIN, name: npub });
  } catch {
    return false;
  }
}

/** Retrieve stored key material, prompting biometric auth. Lets rejections propagate. */
export async function getBiometricUnlockData(npub: string, reason: string): Promise<string> {
  const response = await getData({ domain: BIOMETRIC_UNLOCK_DOMAIN, name: npub, reason });
  return response.data;
}

/** Store key material under biometric-gated secure storage. Lets rejections propagate. */
export async function setBiometricUnlockData(npub: string, data: string): Promise<void> {
  await setData({ domain: BIOMETRIC_UNLOCK_DOMAIN, name: npub, data });
}

/** Remove stored key material, revoking biometric unlock. Lets rejections propagate. */
export async function removeBiometricUnlockData(npub: string): Promise<void> {
  await removeData({ domain: BIOMETRIC_UNLOCK_DOMAIN, name: npub });
}

export type BiometryLabel = 'touchId' | 'windowsHello' | 'generic';

/** Windows Hello reports as `Auto`, not a dedicated enum value. */
export function biometryLabel(type: BiometryType): BiometryLabel {
  switch (type) {
    case BiometryType.TouchID:
      return 'touchId';
    case BiometryType.Auto:
      return 'windowsHello';
    default:
      return 'generic';
  }
}

/** Map a thrown biometry error to an i18n key. Pure: no i18n import, callers do `$t(...)`. */
export function mapBiometricErrorToI18nKey(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes('usercancel')) return 'auth.biometricErrorCancelled';
  if (message.includes('biometrylockout')) return 'auth.biometricErrorLockedOut';
  if (
    message.includes('biometrynotavailable') ||
    message.includes('biometrynotenrolled') ||
    message.includes('notsupported') ||
    message.includes('passcodenotset')
  ) {
    return 'auth.biometricErrorUnavailable';
  }
  return 'auth.biometricErrorGeneric';
}

/**
 * Detects the macOS `keychainError` failure that fires on every `setData`/`getData` call when
 * the app binary lacks a real Apple Developer ID (Team ID) code signature -- ad-hoc signing
 * (`tauri.conf.json`'s `signingIdentity: "-"`, used by both local dev and the current CI release
 * build) is not enough for `SecAccessControl`-protected keychain items and fails with
 * `errSecMissingEntitlement` (-34018). Not fixable from app code; surfaced so a maintainer sees
 * a clear cause instead of a generic failure. Windows Hello storage uses a different backend
 * (WebAuthn, not Keychain) and is unaffected.
 */
export function isKeychainUnavailableError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('keychainerror');
}

/** Sentinel name for the capability probe below; never a real npub, never shown to the user. */
export const BIOMETRIC_CAPABILITY_PROBE_NAME = '__pacto_capability_probe__';

/**
 * macOS-only capability probe: silently attempts a real `setData`/`removeData` round trip with
 * disposable data to detect whether biometric-unlock storage actually works on this build (see
 * `isKeychainUnavailableError` for why it may not), without ever enrolling real data. Safe on
 * macOS because `setData` there shows no OS UI. **Never call this for Windows Hello**: `setData`
 * on Windows always shows an interactive prompt (a passkey-creation dialog on first call per
 * domain, a biometric/PIN prompt on every call after), so probing there would surprise the user
 * with a biometric dialog just for opening Settings. Callers gate this on `biometryLabel(...)
 * === 'touchId'`. Never throws.
 */
export async function canPersistBiometricUnlockData(): Promise<boolean> {
  try {
    await setData({
      domain: BIOMETRIC_UNLOCK_DOMAIN,
      name: BIOMETRIC_CAPABILITY_PROBE_NAME,
      data: 'probe',
    });
  } catch {
    return false;
  }
  try {
    await removeData({ domain: BIOMETRIC_UNLOCK_DOMAIN, name: BIOMETRIC_CAPABILITY_PROBE_NAME });
  } catch {
    // Cleanup is best-effort; the write already succeeded, so storage is usable either way.
  }
  return true;
}
