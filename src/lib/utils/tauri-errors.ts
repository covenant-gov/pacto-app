import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

/** Unwrap stringified `{ code, message }` wallet errors (and similar) to the human message. */
function unwrapJsonErrorString(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const message = (parsed as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      const inner = message.trim();
      return unwrapJsonErrorString(inner) ?? inner;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

/**
 * Extract a user-facing error message from a Tauri invoke rejection or other unknown error.
 * Handles common shapes: Error, { message }, { error }, plain string, nested payloads,
 * and stringified wallet_err_json (`{"code":"…","message":"…"}`).
 */
export function getInvokeErrorMessage(e: unknown, fallback = get(t)('errors.fallback')): string {
  if (e == null) return fallback;
  if (typeof e === 'string') {
    const trimmed = e.trim();
    if (!trimmed) return fallback;
    return unwrapJsonErrorString(trimmed) ?? trimmed;
  }
  const obj = e as Record<string, unknown>;
  if (typeof obj?.message === 'string' && obj.message.trim()) {
    const msg = obj.message.trim();
    return unwrapJsonErrorString(msg) ?? msg;
  }
  if (typeof obj?.error === 'string' && obj.error.trim()) {
    const err = obj.error.trim();
    return unwrapJsonErrorString(err) ?? err;
  }
  const data = obj?.data as Record<string, unknown> | undefined;
  if (data && typeof data?.message === 'string' && data.message.trim()) {
    const msg = data.message.trim();
    return unwrapJsonErrorString(msg) ?? msg;
  }
  if (data && typeof data?.error === 'string' && data.error.trim()) {
    const err = data.error.trim();
    return unwrapJsonErrorString(err) ?? err;
  }
  if (e instanceof Error && e.message?.trim()) {
    const msg = e.message.trim();
    return unwrapJsonErrorString(msg) ?? msg;
  }
  return fallback;
}

const MIGRATION_GATE_MESSAGE = 'Account security must be updated. Unlock the app to migrate.';

/** Marker in `format_transient_skip_error` (src-tauri/src/mls.rs); the tail is the member list. */
const RELAY_KEYPACKAGE_UNREACHABLE = 'could not reach the relays to check key packages for:';

/**
 * Recognize the migration-gate error returned by sensitive backend commands.
 */
export function isMigrationGateError(error: unknown): boolean {
  const message = getInvokeErrorMessage(error, '');
  return message.includes(MIGRATION_GATE_MESSAGE);
}

/**
 * Map known backend error messages to friendlier copy for the UI.
 */
export function friendlyMessage(
  raw: string,
  context: 'dm_send' | 'generic' | 'sponsor' = 'generic'
): string {
  const lower = raw.toLowerCase();
  if (context === 'dm_send') {
    if (lower.includes('invalid npub') || lower.includes('invalid pubkey'))
      return get(t)('errors.dm.invalidNpub');
    if (lower.includes('not initialized') || lower.includes('client not initialized'))
      return get(t)('errors.dm.notInitialized');
    if (lower.includes('missing required key') || lower.includes('invalid args'))
      return get(t)('errors.dm.invalidRequest');
  }
  if (raw.includes(MIGRATION_GATE_MESSAGE)) {
    return get(t)('errors.migrationGate');
  }
  const relayIndex = raw.indexOf(RELAY_KEYPACKAGE_UNREACHABLE);
  if (relayIndex !== -1) {
    const members = raw.slice(relayIndex + RELAY_KEYPACKAGE_UNREACHABLE.length).trim();
    return get(t)('errors.mls.relayKeyPackageUnreachable', { values: { members } });
  }
  if (raw.includes('no sponsor clone registered for this squad id')) {
    return get(t)('governance.error.noSponsorCloneRegistered');
  }
  if (
    context === 'sponsor' &&
    (raw.includes('ETH_CALL_FAILED') ||
      raw.includes('execution reverted') ||
      raw.includes('could not decode return data'))
  ) {
    return get(t)('governance.error.couldNotLoadSponsorBalance');
  }
  return raw;
}
