/**
 * Npub (bech32 public key) validation for DM recipient input.
 * DM_FLOW §7.2: validate bech32 npub (starts with npub1) before sending.
 */

const NPUB_PREFIX = 'npub1';
/** Minimum length for a valid npub: "npub1" (5) + 52 base32 chars = 57 */
const NPUB_MIN_LENGTH = 57;

/**
 * Returns true if the value looks like a valid npub (starts with npub1, minimum length).
 * Trims input. Does not verify bech32 checksum; use for UX validation only.
 */
export function isValidNpub(value: string): boolean {
  const s = value.trim();
  if (!s.startsWith(NPUB_PREFIX)) return false;
  if (s.length < NPUB_MIN_LENGTH) return false;
  return true;
}
