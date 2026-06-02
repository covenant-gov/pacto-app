import { describe, expect, it } from 'vitest';
import { resolveSquadCommonsOnCreate, validatePublicSquadTags } from './squad-commons-fields';

describe('resolveSquadCommonsOnCreate', () => {
  it('strips tags for private squads', () => {
    expect(resolveSquadCommonsOnCreate('private', ['neo'])).toEqual({ visibility: 'private' });
  });

  it('keeps normalized tags for public squads', () => {
    expect(resolveSquadCommonsOnCreate('public', ['#Neo', 'dao'])).toEqual({
      visibility: 'public',
      commonsTags: ['neo', 'dao'],
    });
  });

  it('throws when public without valid tags', () => {
    expect(() => resolveSquadCommonsOnCreate('public', [])).toThrow();
  });
});

describe('validatePublicSquadTags', () => {
  it('requires at least one tag', () => {
    expect(validatePublicSquadTags([])).toMatch(/at least one tag/i);
  });
});
