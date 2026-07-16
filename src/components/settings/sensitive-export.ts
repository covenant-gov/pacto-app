/** Seconds until the backend clears a secret from the clipboard. */
export const EXPORT_CLEAR_SECONDS = 90;

const BACKOFF_SECONDS = /wait\s+(\d+)\s+seconds/i;

/** Pull the wait from the backend rate-limit error, if that is what it is. */
export function parseExportBackoffSeconds(message: string): number | null {
  const match = BACKOFF_SECONDS.exec(message);
  if (!match) return null;
  const seconds = Number.parseInt(match[1], 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds;
}

/** Shorten a public address for display. Never used for secret material. */
export function formatExportAddress(address: string): string {
  const trimmed = address.trim();
  if (trimmed.length < 16) return trimmed;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-6)}`;
}

export type SensitiveExportKind = 'evm' | 'nostr' | 'seed';
