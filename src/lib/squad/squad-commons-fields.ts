import type { SquadVisibility } from '../../stores/squads';
import { normalizeCommonsTags } from '../commons/tags';

export function resolveSquadCommonsOnCreate(
  visibility: SquadVisibility,
  tags: string[]
): { visibility: SquadVisibility; commonsTags?: string[] } {
  if (visibility !== 'public') {
    return { visibility: 'private' };
  }
  const commonsTags = normalizeCommonsTags(tags);
  if (!commonsTags) {
    throw new Error('Public squads need at least one valid tag.');
  }
  return { visibility: 'public', commonsTags };
}

export function validatePublicSquadTags(tags: string[]): string | null {
  if (tags.length === 0) return 'Add at least one tag for a public squad.';
  if (!normalizeCommonsTags(tags)) return 'Use lowercase letters, numbers, or underscores (max 3 tags).';
  return null;
}
