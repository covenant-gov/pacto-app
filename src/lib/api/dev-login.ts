import { invoke } from './index';

/** Login depth accepted by the debug-only `dev_login` backend command. */
export type DevLoginDepth = 'backend' | 'full';

export interface DevLoginOptions {
  /** Overrides `PACTO_DEV_LOGIN_MNEMONIC` for this call. */
  mnemonic?: string;
  /** Overrides `PACTO_DEV_LOGIN_PIN` for this call. */
  pin?: string;
}

/** Returned when full depth has no configured identity — a clean no-op, not an error. */
export interface DevLoginSkipped {
  skipped: true;
  reason: string;
}

/** Returned on a successful login at either depth. */
export interface DevLoginSuccess {
  skipped?: false;
  success: true;
  npub: string;
  /** X-only pubkey, 64 hex chars (no 0x). */
  pubkey_hex: string;
}

export type DevLoginResult = DevLoginSkipped | DevLoginSuccess;

/**
 * Debug-only headless login (`PACTO_ALLOW_TEST_AUTH=1` required). Backend
 * depth is backend-only setup: state is set up but no frontend session
 * should be assumed. Full depth performs a real login and
 * persists real PIN-encrypted credentials; the caller still owns hydrating
 * frontend session state (see `adoptDevSession` in `stores/auth`).
 */
export async function devLogin(
  depth: DevLoginDepth,
  opts: DevLoginOptions = {}
): Promise<DevLoginResult> {
  return await invoke('dev_login', { depth, mnemonic: opts.mnemonic, pin: opts.pin });
}
