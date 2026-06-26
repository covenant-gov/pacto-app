import { describe, expect, it } from 'vitest';
import {
  COMMONS_CATEGORY_TAG_MAX,
  COMMONS_CATEGORY_TAG_MIN,
  COMMONS_TAG_GROUPS,
  COMMONS_TAG_TREE,
} from './tag-catalog';

describe('COMMONS_TAG_TREE', () => {
  it('gives each category between 4 and 6 leaf tags', () => {
    for (const category of COMMONS_TAG_TREE) {
      const n = category.children.length;
      expect(n, `${category.id} has ${n} tags`).toBeGreaterThanOrEqual(COMMONS_CATEGORY_TAG_MIN);
      expect(n, `${category.id} has ${n} tags`).toBeLessThanOrEqual(COMMONS_CATEGORY_TAG_MAX);
    }
  });

  it('sorts leaf tags A–Z by title within each category', () => {
    for (const category of COMMONS_TAG_TREE) {
      const titles = category.children.map((c) => c.title);
      const sorted = [...titles].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );
      expect(titles, category.id).toEqual(sorted);
    }
  });

  it('keeps leaf tag slugs unique across categories', () => {
    const seen = new Set<string>();
    for (const category of COMMONS_TAG_TREE) {
      for (const child of category.children) {
        expect(seen.has(child.tag), `duplicate tag: ${child.tag}`).toBe(false);
        seen.add(child.tag);
      }
    }
    expect(seen.size).toBe(COMMONS_TAG_GROUPS.length);
  });
});
