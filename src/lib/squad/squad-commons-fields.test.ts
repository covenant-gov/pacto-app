import { describe, expect, it } from 'vitest';
import { resolveSquadCommonsOnCreate, validateCommonsOnCreateTags } from './squad-commons-fields';

describe('resolveSquadCommonsOnCreate', () => {
  it('strips tags when Commons is off', () => {
    expect(resolveSquadCommonsOnCreate('private', ['neo', 'dao', 'art'])).toEqual({
      visibility: 'private',
    });
  });

  it('enables Commons without tags when none provided', () => {
    expect(resolveSquadCommonsOnCreate('public', [])).toEqual({ visibility: 'public' });
  });

  it('keeps exactly three normalized tags', () => {
    expect(resolveSquadCommonsOnCreate('public', ['#Neo', 'dao', 'art'])).toEqual({
      visibility: 'public',
      commonsTags: ['neo', 'dao', 'art'],
    });
  });

  it('drops incomplete tag sets', () => {
    expect(resolveSquadCommonsOnCreate('public', ['neo', 'dao'])).toEqual({
      visibility: 'public',
    });
  });
});

describe('validateCommonsOnCreateTags', () => {
  it('requires exactly three tags', () => {
    expect(validateCommonsOnCreateTags([])).toMatch(/exactly 3/i);
    expect(validateCommonsOnCreateTags(['neo', 'dao'])).toMatch(/exactly 3/i);
    expect(validateCommonsOnCreateTags(['neo', 'dao', 'art'])).toBeNull();
  });
});
