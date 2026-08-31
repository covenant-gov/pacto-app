import { normalizeCommonsTag } from './tags';


/**
 * Curated Commons tag tree. Categories are browse-only groupings shown as image
 * tiles; their `children` are the actual filterable #tags (e.g. Communism →
 * marxist, leninist). To add to the taxonomy (mirrors the theme registry in
 * `src/stores/theme.ts`):
 * 1. Optional art: drop a category image at `static/commons-tags/<id>.webp`.
 * 2. Append a `{ id, title, description, image, children }` category, or add a
 *    `{ tag, title }` child to an existing one. Each category: **4–6 leaf tags**,
 *    sorted A–Z by title.
 * Categories without an `image` fall back to a deterministic gradient tile.
 *
 * All `title` and `description` values are svelte-i18n keys. Use the helpers
 * exported below (e.g. `getLocalizedCommonsTagTree`) to get translated strings.
 *
 * Image spec (see ai-docs/commons/COMMONS_PLAN.md → Tag art):
 * ~800×500 WebP/AVIF, < ~80 KB, static stills only (no GIF/video).
 */


export interface CommonsTagGroup {
  /** Normalized hashtag (lowercase, no `#`). Matches broadcast `tags`. */
  tag: string;
  /** i18n key for the display label, e.g. "tags.tag.left.title". */
  title: string;
  /** Optional i18n key for a one-line blurb. */
  description?: string;
}

export interface CommonsTagCategory {
  /** Stable id, also the image filename stem, e.g. "politics". */
  id: string;
  /** i18n key for the display label, e.g. "tags.category.ai.title". */
  title: string;
  /** i18n key for the one-line blurb shown on the tile. */
  description: string;
  /** Filename under `static/commons-tags/`, e.g. "politics.webp". Optional. */
  image?: string;
  /** Filterable leaf tags under this category. */
  children: CommonsTagGroup[];
}

export const COMMONS_TAG_ART_BASE = '/commons-tags/';

/** Inclusive bounds for leaf tags per category tile. */
export const COMMONS_CATEGORY_TAG_MIN = 4;
export const COMMONS_CATEGORY_TAG_MAX = 6;


export const COMMONS_TAG_TREE: CommonsTagCategory[] = [
  {
    id: 'ai',
    title: 'tags.category.ai.title',
    description: 'tags.category.ai.description',
    image: 'nick-land-ai.jpeg',
    children: [
      { tag: 'agents', title: 'tags.tag.agents.title' },
      { tag: 'ai', title: 'tags.tag.ai.title' },
      { tag: 'llm', title: 'tags.tag.llm.title' },
      { tag: 'ml', title: 'tags.tag.ml.title' },
      { tag: 'robotics', title: 'tags.tag.robotics.title' },
    ],
  },
  {
    id: 'anarchism',
    title: 'tags.category.anarchism.title',
    description: 'tags.category.anarchism.description',
    image: 'black-block.jpeg',
    children: [
      { tag: 'anarchist', title: 'tags.tag.anarchist.title' },
      { tag: 'autonomous', title: 'tags.tag.autonomous.title' },
      { tag: 'black_block', title: 'tags.tag.black_block.title' },
      { tag: 'mutual_aid', title: 'tags.tag.mutual_aid.title' },
      { tag: 'syndicalist', title: 'tags.tag.syndicalist.title' },
    ],
  },
  {
    id: 'build',
    title: 'tags.category.build.title',
    description: 'tags.category.build.description',
    image: 'scaffold.jpeg',
    children: [
      { tag: 'builders', title: 'tags.tag.builders.title' },
      { tag: 'design', title: 'tags.tag.design.title' },
      { tag: 'dev', title: 'tags.tag.dev.title' },
      { tag: 'open_source', title: 'tags.tag.open_source.title' },
    ],
  },
  {
    id: 'communism',
    title: 'tags.category.communism.title',
    description: 'tags.category.communism.description',
    image: 'communism.jpeg',
    children: [
      { tag: 'communist', title: 'tags.tag.communist.title' },
      { tag: 'leninist', title: 'tags.tag.leninist.title' },
      { tag: 'maoist', title: 'tags.tag.maoist.title' },
      { tag: 'marxist', title: 'tags.tag.marxist.title' },
    ],
  },
  {
    id: 'crypto',
    title: 'tags.category.crypto.title',
    description: 'tags.category.crypto.description',
    image: 'nouns-nft.jpeg',
    children: [
      { tag: 'crypto', title: 'tags.tag.crypto.title' },
      { tag: 'defi', title: 'tags.tag.defi.title' },
      { tag: 'dex', title: 'tags.tag.dex.title' },
      { tag: 'lending', title: 'tags.tag.lending.title' },
      { tag: 'stablecoin', title: 'tags.tag.stablecoin.title' },
      { tag: 'web3', title: 'tags.tag.web3.title' },
    ],
  },
  {
    id: 'cooperatives',
    title: 'tags.category.cooperatives.title',
    description: 'tags.category.cooperatives.description',
    image: 'women-coop.jpeg',
    children: [
      { tag: 'bread', title: 'tags.tag.bread.title' },
      { tag: 'co_op', title: 'tags.tag.co_op.title' },
      { tag: 'credit_union', title: 'tags.tag.credit_union.title' },
      { tag: 'housing_coop', title: 'tags.tag.housing_coop.title' },
      { tag: 'member_owned', title: 'tags.tag.member_owned.title' },
      { tag: 'worker_coop', title: 'tags.tag.worker_coop.title' },
    ],
  },
  {
    id: 'culture',
    title: 'tags.category.culture.title',
    description: 'tags.category.culture.description',
    image: 'curved-lines.jpeg',
    children: [
      { tag: 'art', title: 'tags.tag.art.title' },
      { tag: 'film', title: 'tags.tag.film.title' },
      { tag: 'literature', title: 'tags.tag.literature.title' },
      { tag: 'music', title: 'tags.tag.music.title' },
      { tag: 'theater', title: 'tags.tag.theater.title' },
      { tag: 'writing', title: 'tags.tag.writing.title' },
    ],
  },
  {
    id: 'dao',
    title: 'tags.category.dao.title',
    description: 'tags.category.dao.description',
    image: 'daohaus.jpeg',
    children: [
      { tag: 'dao', title: 'tags.tag.dao.title' },
      { tag: 'moloch', title: 'tags.tag.moloch.title' },
      { tag: 'multisig', title: 'tags.tag.multisig.title' },
      { tag: 'onchain', title: 'tags.tag.onchain.title' },
      { tag: 'token_gov', title: 'tags.tag.token_gov.title' },
    ],
  },
  {
    id: 'economics',
    title: 'tags.category.economics.title',
    description: 'tags.category.economics.description',
    image: 'bricks.jpeg',
    children: [
      { tag: 'economics', title: 'tags.tag.economics.title' },
      { tag: 'free_market', title: 'tags.tag.free_market.title' },
      { tag: 'labor', title: 'tags.tag.labor.title' },
      { tag: 'planned_economy', title: 'tags.tag.planned_economy.title' },
      { tag: 'trade', title: 'tags.tag.trade.title' },
    ],
  },
  {
    id: 'governance',
    title: 'tags.category.governance.title',
    description: 'tags.category.governance.description',
    image: 'governance.jpeg',
    children: [
      { tag: 'coordination', title: 'tags.tag.coordination.title' },
      { tag: 'decentralization', title: 'tags.tag.decentralization.title' },
      { tag: 'democracy', title: 'tags.tag.democracy.title' },
      { tag: 'federalism', title: 'tags.tag.federalism.title' },
      { tag: 'governance', title: 'tags.tag.governance.title' },
    ],
  },
  {
    id: 'identity',
    title: 'tags.category.identity.title',
    description: 'tags.category.identity.description',
    image: 'double-rainbow.jpg',
    children: [
      { tag: 'bipoc', title: 'tags.tag.bipoc.title' },
      { tag: 'lgbtqia_plus', title: 'tags.tag.lgbtqia_plus.title' },
      { tag: 'trans', title: 'tags.tag.trans.title' },
      { tag: 'women', title: 'tags.tag.women.title' },
    ],
  },
  {
    id: 'knowledge',
    title: 'tags.category.knowledge.title',
    description: 'tags.category.knowledge.description',
    image: 'aya.jpeg',
    children: [
      { tag: 'academia', title: 'tags.tag.academia.title' },
      { tag: 'education', title: 'tags.tag.education.title' },
      { tag: 'learning', title: 'tags.tag.learning.title' },
      { tag: 'research', title: 'tags.tag.research.title' },
      { tag: 'science', title: 'tags.tag.science.title' },
    ],
  },
  {
    id: 'libertarianism',
    title: 'tags.category.libertarianism.title',
    description: 'tags.category.libertarianism.description',
    image: 'libertarianism.jpeg',
    children: [
      { tag: 'capitalist', title: 'tags.tag.capitalist.title' },
      { tag: 'libertarian', title: 'tags.tag.libertarian.title' },
      { tag: 'moderate', title: 'tags.tag.moderate.title' },
      { tag: 'right', title: 'tags.tag.right.title' },
    ],
  },
  {
    id: 'local',
    title: 'tags.category.local.title',
    description: 'tags.category.local.description',
    image: 'civil-rights-march.jpeg',
    children: [
      { tag: 'community', title: 'tags.tag.community.title' },
      { tag: 'events', title: 'tags.tag.events.title' },
      { tag: 'irl', title: 'tags.tag.irl.title' },
      { tag: 'local', title: 'tags.tag.local.title' },
    ],
  },
  {
    id: 'privacy',
    title: 'tags.category.privacy.title',
    description: 'tags.category.privacy.description',
    image: 'distorted-tv.jpeg',
    children: [
      { tag: 'anonymity', title: 'tags.tag.anonymity.title' },
      { tag: 'cypherpunk', title: 'tags.tag.cypherpunk.title' },
      { tag: 'encryption', title: 'tags.tag.encryption.title' },
      { tag: 'opsec', title: 'tags.tag.opsec.title' },
      { tag: 'privacy', title: 'tags.tag.privacy.title' },
      { tag: 'surveillance', title: 'tags.tag.surveillance.title' },
    ],
  },
  {
    id: 'socialist',
    title: 'tags.category.socialist.title',
    description: 'tags.category.socialist.description',
    image: 'socialist-cloud.jpeg',
    children: [
      { tag: 'left', title: 'tags.tag.left.title' },
      { tag: 'public_ownership', title: 'tags.tag.public_ownership.title' },
      { tag: 'reformist', title: 'tags.tag.reformist.title' },
      { tag: 'socdem', title: 'tags.tag.socdem.title' },
      { tag: 'socialist', title: 'tags.tag.socialist.title' },
    ],
  },
  {
    id: 'spirituality',
    title: 'tags.category.spirituality.title',
    description: 'tags.category.spirituality.description',
    children: [
      { tag: 'faith', title: 'tags.tag.faith.title' },
      { tag: 'monotheism', title: 'tags.tag.monotheism.title' },
      { tag: 'mysticism', title: 'tags.tag.mysticism.title' },
      { tag: 'pantheism', title: 'tags.tag.pantheism.title' },
      { tag: 'polytheism', title: 'tags.tag.polytheism.title' },
      { tag: 'spiritual', title: 'tags.tag.spiritual.title' },
    ],
  },
  {
    id: 'technology',
    title: 'tags.category.technology.title',
    description: 'tags.category.technology.description',
    image: 'gamer.jpeg',
    children: [
      { tag: 'hardware', title: 'tags.tag.hardware.title' },
      { tag: 'infra', title: 'tags.tag.infra.title' },
      { tag: 'networking', title: 'tags.tag.networking.title' },
      { tag: 'software', title: 'tags.tag.software.title' },
      { tag: 'systems', title: 'tags.tag.systems.title' },
      { tag: 'tech', title: 'tags.tag.tech.title' },
    ],
  },
  {
    id: 'university',
    title: 'tags.category.university.title',
    description: 'tags.category.university.description',
    image: 'uni.jpeg',
    children: [
      { tag: 'campus', title: 'tags.tag.campus.title' },
      { tag: 'faculty', title: 'tags.tag.faculty.title' },
      { tag: 'graduate', title: 'tags.tag.graduate.title' },
      { tag: 'students', title: 'tags.tag.students.title' },
      { tag: 'undergrad', title: 'tags.tag.undergrad.title' },
      { tag: 'university', title: 'tags.tag.university.title' },
    ],
  },
  {
    id: 'unions',
    title: 'tags.category.unions.title',
    description: 'tags.category.unions.description',
    children: [
      { tag: 'collective_bargaining', title: 'tags.tag.collective_bargaining.title' },
      { tag: 'labor_union', title: 'tags.tag.labor_union.title' },
      { tag: 'strike', title: 'tags.tag.strike.title' },
      { tag: 'trade_union', title: 'tags.tag.trade_union.title' },
      { tag: 'union', title: 'tags.tag.union.title' },
    ],
  },
];


/** Flattened, de-duplicated leaf tags across all categories. */
export const COMMONS_TAG_GROUPS: CommonsTagGroup[] = (() => {
  const seen = new Set<string>();
  const out: CommonsTagGroup[] = [];
  for (const category of COMMONS_TAG_TREE) {
    for (const child of category.children) {
      if (seen.has(child.tag)) continue;
      seen.add(child.tag);
      out.push(child);
    }
  }
  return out;
})();

const GROUPS_BY_TAG = new Map<string, CommonsTagGroup>(
  COMMONS_TAG_GROUPS.map((g) => [g.tag, g])
);

const CATEGORIES_BY_ID = new Map<string, CommonsTagCategory>(
  COMMONS_TAG_TREE.map((c) => [c.id, c])
);

export function findCommonsTagCategory(id: string): CommonsTagCategory | null {
  return CATEGORIES_BY_ID.get(id) ?? null;
}

/** Leaf tag slugs for a category (used for broad ANY-of-category feed search). */
export function commonsCategoryTagSlugs(category: CommonsTagCategory): string[] {
  return category.children.map((c) => c.tag);
}

/** Drop user-hidden category tiles from the browse grid. */
export function filterVisibleCommonsCategories(
  categories: CommonsTagCategory[],
  hiddenCategoryIds: ReadonlySet<string>
): CommonsTagCategory[] {
  return hiddenCategoryIds.size === 0 ? categories : categories.filter((c) => !hiddenCategoryIds.has(c.id));
}

export function findCommonsTagGroup(tag: string): CommonsTagGroup | null {
  const normalized = normalizeCommonsTag(tag);
  if (!normalized) return null;
  return GROUPS_BY_TAG.get(normalized) ?? null;
}

export function commonsTagArtSrc(source: { image?: string }): string | null {
  return source.image ? `${COMMONS_TAG_ART_BASE}${source.image}` : null;
}

/** Sum of active broadcasts across a category's child tags. */
export function commonsCategoryLiveCount(
  category: CommonsTagCategory,
  countsByTag: Record<string, number>
): number {
  return category.children.reduce((sum, child) => sum + (countsByTag[child.tag] ?? 0), 0);
}

/** Deterministic gradient so a tile looks intentional with no image set. */
export function commonsTagGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  const h1 = hash;
  const h2 = (hash + 48) % 360;
  return `linear-gradient(135deg, hsl(${h1} 62% 30%), hsl(${h2} 58% 18%))`;
}

export type CommonsTagTranslator = (key: string) => string;

/** Translate a leaf tag group for display. */
export function localizeCommonsTagGroup(
  t: CommonsTagTranslator,
  group: CommonsTagGroup
): CommonsTagGroup {
  return {
    tag: group.tag,
    title: t(group.title),
    description: group.description ? t(group.description) : undefined,
  };
}

/** Translate a category (including its children) for display. */
export function localizeCommonsTagCategory(
  t: CommonsTagTranslator,
  category: CommonsTagCategory
): CommonsTagCategory {
  return {
    ...category,
    title: t(category.title),
    description: t(category.description),
    children: category.children.map((child) => localizeCommonsTagGroup(t, child)),
  };
}

/** Full translated tag tree. */
export function getLocalizedCommonsTagTree(t: CommonsTagTranslator): CommonsTagCategory[] {
  return COMMONS_TAG_TREE.map((category) => localizeCommonsTagCategory(t, category));
}

/** Flattened, translated leaf tags. */
export function getLocalizedCommonsTagGroups(t: CommonsTagTranslator): CommonsTagGroup[] {
  return COMMONS_TAG_GROUPS.map((group) => localizeCommonsTagGroup(t, group));
}

/** Find and translate a single category. */
export function getLocalizedCommonsTagCategory(
  t: CommonsTagTranslator,
  id: string
): CommonsTagCategory | null {
  const category = findCommonsTagCategory(id);
  return category ? localizeCommonsTagCategory(t, category) : null;
}

/** Find and translate a single leaf tag. */
export function getLocalizedCommonsTagGroup(
  t: CommonsTagTranslator,
  tag: string
): CommonsTagGroup | null {
  const group = findCommonsTagGroup(tag);
  return group ? localizeCommonsTagGroup(t, group) : null;
}
