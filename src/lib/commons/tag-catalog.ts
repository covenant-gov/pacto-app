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
 * Image spec (see ai-docs/commons/COMMONS_PLAN.md → Tag art):
 * ~800×500 WebP/AVIF, < ~80 KB, static stills only (no GIF/video).
 */
export interface CommonsTagGroup {
  /** Normalized hashtag (lowercase, no `#`). Matches broadcast `tags`. */
  tag: string;
  /** Display label, e.g. "Left". */
  title: string;
  /** Optional one-line blurb. */
  description?: string;
}

export interface CommonsTagCategory {
  /** Stable id, also the image filename stem, e.g. "politics". */
  id: string;
  /** Display label, e.g. "POLITICS". */
  title: string;
  /** One-line blurb shown on the tile. */
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
    title: 'AI',
    description: 'Models, agents, and machine learning work.',
    image: 'nick-land-ai.jpeg',
    children: [
      { tag: 'agents', title: 'Agents' },
      { tag: 'ai', title: 'AI' },
      { tag: 'llm', title: 'LLM' },
      { tag: 'ml', title: 'ML' },
      { tag: 'robotics', title: 'Robotics' },
    ],
  },
  {
    id: 'anarchism',
    title: 'ANARCHISM',
    description: 'Autonomy, mutual aid, and horizontal organizing.',
    image: 'black-block.jpeg',
    children: [
      { tag: 'anarchist', title: 'Anarchist' },
      { tag: 'autonomous', title: 'Autonomous' },
      { tag: 'black_block', title: 'Black Block' },
      { tag: 'mutual_aid', title: 'Mutual Aid' },
      { tag: 'syndicalist', title: 'Syndicalist' },
    ],
  },
  {
    id: 'build',
    title: 'BUILD',
    description: 'Makers shipping tools, contracts, and apps.',
    image: 'scaffold.jpeg',
    children: [
      { tag: 'builders', title: 'Builders' },
      { tag: 'design', title: 'Design' },
      { tag: 'dev', title: 'Dev' },
      { tag: 'open_source', title: 'Open Source' },
    ],
  },
  {
    id: 'communism',
    title: 'COMMUNISM',
    description: 'Marxist, Leninist, and communist organizing.',
    image: 'communism.jpeg',
    children: [
      { tag: 'communist', title: 'Communist' },
      { tag: 'leninist', title: 'Leninist' },
      { tag: 'maoist', title: 'Maoist' },
      { tag: 'marxist', title: 'Marxist' },
    ],
  },
  {
    id: 'crypto',
    title: 'CRYPTO',
    description: 'Chains, wallets, DeFi, and on-chain finance.',
    image: 'nouns-nft.jpeg',
    children: [
      { tag: 'crypto', title: 'Crypto' },
      { tag: 'defi', title: 'DeFi' },
      { tag: 'dex', title: 'DEX' },
      { tag: 'lending', title: 'Lending' },
      { tag: 'stablecoin', title: 'Stablecoin' },
      { tag: 'web3', title: 'Web3' },
    ],
  },
  {
    id: 'cooperatives',
    title: 'COOPERATIVES',
    description: 'Member-owned co-ops, credit unions, and shared enterprise.',
    image: 'women-coop.jpeg',
    children: [
      { tag: 'bread', title: 'Bread' },
      { tag: 'co_op', title: 'Co-op' },
      { tag: 'credit_union', title: 'Credit Union' },
      { tag: 'housing_coop', title: 'Housing Co-op' },
      { tag: 'member_owned', title: 'Member Owned' },
      { tag: 'worker_coop', title: 'Worker Co-op' },
    ],
  },
  {
    id: 'culture',
    title: 'CULTURE',
    description: 'Art, sound, and creative work.',
    image: 'curved-lines.jpeg',
    children: [
      { tag: 'art', title: 'Art' },
      { tag: 'film', title: 'Film' },
      { tag: 'literature', title: 'Literature' },
      { tag: 'music', title: 'Music' },
      { tag: 'theater', title: 'Theater' },
      { tag: 'writing', title: 'Writing' },
    ],
  },
  {
    id: 'dao',
    title: 'DAO',
    description: 'On-chain groups, multisigs, and collective treasuries.',
    image: 'daohaus.jpeg',
    children: [
      { tag: 'dao', title: 'DAO' },
      { tag: 'moloch', title: 'Moloch' },
      { tag: 'multisig', title: 'Multisig' },
      { tag: 'onchain', title: 'On-chain' },
      { tag: 'token_gov', title: 'Token Gov' },
    ],
  },
  {
    id: 'economics',
    title: 'ECONOMICS',
    description: 'Markets, planning, labor, and economic models.',
    image: 'bricks.jpeg',
    children: [
      { tag: 'economics', title: 'Economics' },
      { tag: 'free_market', title: 'Free Market' },
      { tag: 'labor', title: 'Labor' },
      { tag: 'planned_economy', title: 'Planned Economy' },
      { tag: 'trade', title: 'Trade' },
    ],
  },
  {
    id: 'governance',
    title: 'GOVERNANCE',
    description: 'How groups decide — across ideologies and scales.',
    image: 'governance.jpeg',
    children: [
      { tag: 'coordination', title: 'Coordination' },
      { tag: 'decentralization', title: 'Decentralization' },
      { tag: 'democracy', title: 'Democracy' },
      { tag: 'federalism', title: 'Federalism' },
      { tag: 'governance', title: 'Governance' },
    ],
  },
  {
    id: 'identity',
    title: 'IDENTITY',
    description: 'Community, belonging, and lived experience.',
    image: 'double-rainbow.jpg',
    children: [
      { tag: 'bipoc', title: 'BIPOC' },
      { tag: 'lgbtqia_plus', title: 'LGBTQIA+' },
      { tag: 'trans', title: 'Trans' },
      { tag: 'women', title: 'Women' },
    ],
  },
  {
    id: 'knowledge',
    title: 'KNOWLEDGE',
    description: 'Research, science, and learning.',
    image: 'aya.jpeg',
    children: [
      { tag: 'academia', title: 'Academia' },
      { tag: 'education', title: 'Education' },
      { tag: 'learning', title: 'Learning' },
      { tag: 'research', title: 'Research' },
      { tag: 'science', title: 'Science' },
    ],
  },
  {
    id: 'libertarianism',
    title: 'LIBERTARIANISM',
    description: 'Markets, capitalist organizing, and libertarian politics.',
    image: 'libertarianism.jpeg',
    children: [
      { tag: 'capitalist', title: 'Capitalist' },
      { tag: 'libertarian', title: 'Libertarian' },
      { tag: 'moderate', title: 'Moderate' },
      { tag: 'right', title: 'Right' },
    ],
  },
  {
    id: 'local',
    title: 'LOCAL',
    description: 'People organizing by place and IRL.',
    image: 'civil-rights-march.jpeg',
    children: [
      { tag: 'community', title: 'Community' },
      { tag: 'events', title: 'Events' },
      { tag: 'irl', title: 'IRL' },
      { tag: 'local', title: 'Local' },
    ],
  },
  {
    id: 'privacy',
    title: 'PRIVACY',
    description: 'Encryption, anonymity, and resisting surveillance.',
    image: 'distorted-tv.jpeg',
    children: [
      { tag: 'anonymity', title: 'Anonymity' },
      { tag: 'cypherpunk', title: 'Cypherpunk' },
      { tag: 'encryption', title: 'Encryption' },
      { tag: 'opsec', title: 'Opsec' },
      { tag: 'privacy', title: 'Privacy' },
      { tag: 'surveillance', title: 'Surveillance' },
    ],
  },
  {
    id: 'socialist',
    title: 'SOCIALISM',
    description: 'Social democracy, public ownership, and reform organizing.',
    image: 'socialist-cloud.jpeg',
    children: [
      { tag: 'left', title: 'Left' },
      { tag: 'public_ownership', title: 'Public Ownership' },
      { tag: 'reformist', title: 'Reformist' },
      { tag: 'socdem', title: 'Social Democrat' },
      { tag: 'socialist', title: 'Socialist' },
    ],
  },
  {
    id: 'spirituality',
    title: 'SPIRITUALITY',
    description: 'Faith, practice, and the sacred — without denomination labels.',
    children: [
      { tag: 'faith', title: 'Faith' },
      { tag: 'monotheism', title: 'Monotheism' },
      { tag: 'mysticism', title: 'Mysticism' },
      { tag: 'pantheism', title: 'Pantheism' },
      { tag: 'polytheism', title: 'Polytheism' },
      { tag: 'spiritual', title: 'Spiritual' },
    ],
  },
  {
    id: 'technology',
    title: 'TECHNOLOGY',
    description: 'Hardware, software, networks, and systems.',
    image: 'gamer.jpeg',
    children: [
      { tag: 'hardware', title: 'Hardware' },
      { tag: 'infra', title: 'Infra' },
      { tag: 'networking', title: 'Networking' },
      { tag: 'software', title: 'Software' },
      { tag: 'systems', title: 'Systems' },
      { tag: 'tech', title: 'Tech' },
    ],
  },
  {
    id: 'university',
    title: 'UNIVERSITY',
    description: 'Campus life, students, and academic organizing.',
    image: 'uni.jpeg',
    children: [
      { tag: 'campus', title: 'Campus' },
      { tag: 'faculty', title: 'Faculty' },
      { tag: 'graduate', title: 'Graduate' },
      { tag: 'students', title: 'Students' },
      { tag: 'undergrad', title: 'Undergrad' },
      { tag: 'university', title: 'University' },
    ],
  },
  {
    id: 'unions',
    title: 'UNIONS',
    description: 'Strikes, bargaining, and labor union organizing.',
    children: [
      { tag: 'collective_bargaining', title: 'Collective Bargaining' },
      { tag: 'labor_union', title: 'Labor Union' },
      { tag: 'strike', title: 'Strike' },
      { tag: 'trade_union', title: 'Trade Union' },
      { tag: 'union', title: 'Union' },
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
