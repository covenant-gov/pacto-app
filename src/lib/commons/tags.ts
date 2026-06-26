const TAG_PATTERN = /^[a-z0-9_]{1,32}$/;

/** Reserved tags the app applies automatically; users cannot self-select them. */
export const COMMONS_NEW_TAG = 'new';
export const RESERVED_COMMONS_TAGS: readonly string[] = [COMMONS_NEW_TAG];

export function normalizeCommonsTag(raw: string): string | null {
  const t = raw.trim().replace(/^#+/, '').toLowerCase();
  if (!t || !TAG_PATTERN.test(t)) return null;
  return t;
}

export function isReservedCommonsTag(raw: string): boolean {
  const t = normalizeCommonsTag(raw);
  return t !== null && RESERVED_COMMONS_TAGS.includes(t);
}

/**
 * Returns normalized unique author-selectable tags, or null when invalid.
 * Rejects reserved tags (e.g. `#new`) — those are applied by the app only.
 */
export function normalizeCommonsTags(raw: string[]): string[] | null {
  if (raw.length === 0 || raw.length > 3) return null;
  const out: string[] = [];
  for (const item of raw) {
    const t = normalizeCommonsTag(item);
    if (!t || RESERVED_COMMONS_TAGS.includes(t)) return null;
    if (!out.includes(t)) out.push(t);
  }
  return out.length > 0 ? out : null;
}
