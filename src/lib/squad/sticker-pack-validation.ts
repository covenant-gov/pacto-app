/** Identifies one shortcode entry within a pack draft for duplicate detection. */
export interface ShortcodeCandidate {
  id: string;
  shortcode: string;
}

export type ShortcodeValidationError = 'empty' | 'duplicate';

/**
 * Validate one entry's shortcode against the rest of the pack draft.
 * Duplicate detection is case-insensitive and ignores the candidate's own id.
 * Returns null when the shortcode is valid.
 */
export function validateShortcode(
  candidate: ShortcodeCandidate,
  entries: readonly ShortcodeCandidate[],
): ShortcodeValidationError | null {
  const trimmed = candidate.shortcode.trim();
  if (!trimmed) return 'empty';
  const duplicate = entries.some(
    (other) => other.id !== candidate.id && other.shortcode.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  return duplicate ? 'duplicate' : null;
}
