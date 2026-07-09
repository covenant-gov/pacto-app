import { describe, expect, it } from 'vitest';
import {
  normalizeCommonsTag,
  normalizeCommonsTags,
  normalizeSquadBroadcastTags,
  isReservedCommonsTag,
} from './tags';

describe('normalizeCommonsTag', () => {
  it('strips hash and lowercases', () => {
    expect(normalizeCommonsTag('#Neo')).toBe('neo');
    expect(normalizeCommonsTag('DAO')).toBe('dao');
  });

  it('rejects invalid characters', () => {
    expect(normalizeCommonsTag('bad-hyphen')).toBeNull();
    expect(normalizeCommonsTag('')).toBeNull();
  });
});

describe('normalizeCommonsTags', () => {
  it('dedupes and caps at three', () => {
    expect(normalizeCommonsTags(['#neo', 'NEO', 'dao'])).toEqual(['neo', 'dao']);
    expect(normalizeCommonsTags(['a', 'b', 'c', 'd'])).toBeNull();
  });

  it('requires at least one tag', () => {
    expect(normalizeCommonsTags([])).toBeNull();
  });

  it('rejects the reserved #new tag from author input', () => {
    expect(normalizeCommonsTags(['new'])).toBeNull();
    expect(normalizeCommonsTags(['neo', '#NEW'])).toBeNull();
  });
});

describe('normalizeSquadBroadcastTags', () => {
  it('requires exactly three unique tags', () => {
    expect(normalizeSquadBroadcastTags(['neo', 'dao'])).toBeNull();
    expect(normalizeSquadBroadcastTags(['neo', 'dao', 'art'])).toEqual(['neo', 'dao', 'art']);
    expect(normalizeSquadBroadcastTags(['#Neo', 'NEO', 'dao', 'art'])).toBeNull();
  });
});

describe('isReservedCommonsTag', () => {
  it('flags #new only', () => {
    expect(isReservedCommonsTag('new')).toBe(true);
    expect(isReservedCommonsTag('#New')).toBe(true);
    expect(isReservedCommonsTag('neo')).toBe(false);
  });
});

describe('isReservedCommonsTag', () => {
  it('flags #new only', () => {
    expect(isReservedCommonsTag('new')).toBe(true);
    expect(isReservedCommonsTag('#New')).toBe(true);
    expect(isReservedCommonsTag('neo')).toBe(false);
  });
});
