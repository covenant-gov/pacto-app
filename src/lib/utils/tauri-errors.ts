/**
 * Extract a user-facing error message from a Tauri invoke rejection or other unknown error.
 * Handles common shapes: Error, { message }, { error }, plain string, nested payloads.
 */
export function getInvokeErrorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e == null) return fallback;
  if (typeof e === 'string') return e.trim() || fallback;
  const obj = e as Record<string, unknown>;
  if (typeof obj?.message === 'string' && obj.message.trim()) return obj.message.trim();
  if (typeof obj?.error === 'string' && obj.error.trim()) return obj.error.trim();
  const data = obj?.data as Record<string, unknown> | undefined;
  if (data && typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  if (data && typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
  if (e instanceof Error && e.message?.trim()) return e.message.trim();
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
