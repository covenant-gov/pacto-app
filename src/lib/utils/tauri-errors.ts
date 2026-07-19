/** Unwrap stringified `{ code, message }` wallet errors (and similar) to the human message. */
function unwrapJsonErrorString(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const message = (parsed as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
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
export function getInvokeErrorMessage(e: unknown, fallback = 'Something went wrong'): string {
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

/**
 * Map known backend error messages to friendlier copy for the UI.
 */
export function friendlyMessage(raw: string, context: 'dm_send' | 'generic' = 'generic'): string {
  const lower = raw.toLowerCase();
  if (context === 'dm_send') {
    if (lower.includes('invalid npub') || lower.includes('invalid pubkey'))
      return 'Please enter a valid npub (starts with npub1).';
    if (lower.includes('not initialized') || lower.includes('client not initialized'))
      return 'Please log in first.';
    if (lower.includes('missing required key') || lower.includes('invalid args'))
      return 'Invalid request. Please try again.';
  }
  return raw;
}
