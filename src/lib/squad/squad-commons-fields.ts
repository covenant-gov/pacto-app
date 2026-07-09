import type { SquadVisibility } from '../../stores/squads';
import { normalizeSquadBroadcastTags } from '../commons/tags';

/**
 * Catalog prefs for Commons broadcasting.
 * `visibility: 'public'` means Commons on (wire); the MLS squad stays private.
 * Create-with-Commons-on auto-broadcasts, so callers should pass exactly 3 tags.
 * Enabling Commons later in settings may omit tags until the first broadcast.
 */
export function resolveSquadCommonsOnCreate(
  visibility: SquadVisibility,
  tags: string[]
): { visibility: SquadVisibility; commonsTags?: string[] } {
  if (visibility !== 'public') {
    return { visibility: 'private' };
  }
  const commonsTags = normalizeSquadBroadcastTags(tags) ?? undefined;
  return { visibility: 'public', commonsTags };
}

/** Create flow with Commons on: exactly 3 tags (auto `#new` broadcast). */
export function validateCommonsOnCreateTags(tags: string[]): string | null {
  if (!normalizeSquadBroadcastTags(tags)) {
    return 'Choose exactly 3 tags for the Commons discovery card.';
  }
  return null;
}

/** @deprecated Use validateCommonsOnCreateTags */
export function validatePublicSquadTags(tags: string[]): string | null {
  return validateCommonsOnCreateTags(tags);
}
