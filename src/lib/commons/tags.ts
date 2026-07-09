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
 * Default: 1–3 tags (user broadcasts). Pass `{ exact: 3 }` for squad broadcasts.
 */
export function normalizeCommonsTags(
  raw: string[],
  opts?: { exact?: number }
): string[] | null {
  const exact = opts?.exact;
  if (exact != null) {
    if (raw.length !== exact) return null;
  } else if (raw.length === 0 || raw.length > 3) {
    return null;
  }
  const out: string[] = [];
  for (const item of raw) {
    const t = normalizeCommonsTag(item);
    if (!t || RESERVED_COMMONS_TAGS.includes(t)) return null;
    if (!out.includes(t)) out.push(t);
  }
  if (exact != null) {
    return out.length === exact ? out : null;
  }
  return out.length > 0 ? out : null;
}

/** Squad Commons broadcasts require exactly three author-selectable tags. */
export function normalizeSquadBroadcastTags(raw: string[]): string[] | null {
  return normalizeCommonsTags(raw, { exact: 3 });
}
