import type { CommonsBroadcastDto } from './types';
import { findCommonsTagCategory, commonsCategoryTagSlugs } from './tag-catalog';

export type CommonsSubjectFilter = 'both' | 'squads' | 'users';
export type CommonsAudienceFilter = 'any' | 'new_user' | 'active_user';

export interface CommonsFeedFilters {
  /** Focused search: broadcast must include every tag (max 3 in UI). */
  tags: string[];
  /** Category browse: broadcast must include any tag in the category. Mutually exclusive with `tags`. */
  categoryId: string | null;
  subjectFilter: CommonsSubjectFilter;
  audienceFilter: CommonsAudienceFilter;
}

export const DEFAULT_COMMONS_FEED_FILTERS: CommonsFeedFilters = {
  tags: [],
  categoryId: null,
  subjectFilter: 'both',
  audienceFilter: 'any',
};

export const COMMONS_FEED_REFRESH_MS = 60_000;

export function isCommonsBroadcastActive(
  broadcast: CommonsBroadcastDto,
  nowSecs = Math.floor(Date.now() / 1000)
): boolean {
  return broadcast.expiresAt > nowSecs;
}

export function dedupeCommonsBroadcasts(broadcasts: CommonsBroadcastDto[]): CommonsBroadcastDto[] {
  const byKey = new Map<string, CommonsBroadcastDto>();
  for (const broadcast of broadcasts) {
    const key = `${broadcast.authorNpub}:${broadcast.subject}:${broadcast.subjectId}`;
    const existing = byKey.get(key);
    if (!existing || broadcast.createdAt > existing.createdAt) {
      byKey.set(key, broadcast);
    }
  }
  return [...byKey.values()];
}

export function sortCommonsBroadcasts(broadcasts: CommonsBroadcastDto[]): CommonsBroadcastDto[] {
  return [...broadcasts].sort((a, b) => b.createdAt - a.createdAt);
}

function matchesSubjectFilter(
  broadcast: CommonsBroadcastDto,
  subjectFilter: CommonsSubjectFilter
): boolean {
  if (subjectFilter === 'both') return true;
  if (subjectFilter === 'squads') return broadcast.subject === 'squad';
  return broadcast.subject === 'user';
}

function matchesAudienceFilter(
  broadcast: CommonsBroadcastDto,
  audienceFilter: CommonsAudienceFilter
): boolean {
  if (audienceFilter === 'any') return true;
  return broadcast.subject === 'user' && broadcast.audience === audienceFilter;
}

function matchesTagFilter(
  broadcast: CommonsBroadcastDto,
  tags: string[],
  categoryId: string | null
): boolean {
  const eventTags = new Set(broadcast.tags.map((t) => t.toLowerCase()));

  // Focused tag chips: every selected tag must be present.
  if (tags.length > 0) {
    return tags.map((t) => t.toLowerCase()).every((t) => eventTags.has(t));
  }

  // Category tile search: any leaf tag in the category qualifies.
  if (categoryId) {
    const category = findCommonsTagCategory(categoryId);
    if (!category) return true;
    const slugs = commonsCategoryTagSlugs(category).map((t) => t.toLowerCase());
    return slugs.some((t) => eventTags.has(t));
  }

  return true;
}

export function filterCommonsBroadcasts(
  broadcasts: CommonsBroadcastDto[],
  filters: CommonsFeedFilters,
  nowSecs = Math.floor(Date.now() / 1000)
): CommonsBroadcastDto[] {
  return broadcasts
    .filter((b) => isCommonsBroadcastActive(b, nowSecs))
    .filter((b) => matchesSubjectFilter(b, filters.subjectFilter))
    .filter((b) => matchesAudienceFilter(b, filters.audienceFilter))
    .filter((b) => matchesTagFilter(b, filters.tags, filters.categoryId));
}

export function prepareCommonsFeed(broadcasts: CommonsBroadcastDto[], filters: CommonsFeedFilters): CommonsBroadcastDto[] {
  return sortCommonsBroadcasts(filterCommonsBroadcasts(dedupeCommonsBroadcasts(broadcasts), filters));
}
