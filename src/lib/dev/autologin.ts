/**
 * Debug-only startup hook: asks the backend for a configured dev identity
 * and, if one exists, drives the same session-hydration path a human login
 * uses. Called unconditionally on every debug boot (see `+layout.svelte`),
 * so it must be a silent no-op when no identity is configured — the app
 * then falls through to the normal welcome screen.
 */

import { devLogin } from '../api/dev-login';
import { adoptDevSession } from '../../stores/auth';

export async function runDevAutologin(): Promise<void> {
  if (!import.meta.env.DEV) return;

  let result;
  try {
    result = await devLogin('full');
  } catch (e) {
    console.warn(
      '[dev-autologin] dev_login failed:',
      e instanceof Error ? e.message : String(e)
    );
    return;
  }

  if (result.skipped) return;

  await adoptDevSession({ npub: result.npub, pubkey: result.npub });
}
