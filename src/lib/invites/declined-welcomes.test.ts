import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { declinedWelcomeGroupIds } from '../../stores/invite-decisions';
import {
  clearDeclinedWelcomeGroupId,
  recordDeclinedWelcomeGroupId,
  sameMlsGroupId,
} from './declined-welcomes';

describe('sameMlsGroupId', () => {
  it('compares trimmed case-insensitive ids', () => {
    expect(sameMlsGroupId('abc', 'ABC')).toBe(true);
    expect(sameMlsGroupId('  abc  ', 'abc')).toBe(true);
    expect(sameMlsGroupId('a', 'b')).toBe(false);
  });
});

describe('recordDeclinedWelcomeGroupId', () => {
  beforeEach(() => {
    declinedWelcomeGroupIds.set([]);
  });

  afterEach(() => {
    declinedWelcomeGroupIds.set([]);
  });

  it('appends a group id to the declinedWelcomeGroupIds store', () => {
    recordDeclinedWelcomeGroupId('group-1');
    expect(get(declinedWelcomeGroupIds)).toEqual(['group-1']);
  });

  it('clearDeclinedWelcomeGroupId removes a prior decline', () => {
    recordDeclinedWelcomeGroupId('group-1');
    clearDeclinedWelcomeGroupId('group-1');
    expect(get(declinedWelcomeGroupIds)).toEqual([]);
  });

  it('is idempotent for the exact same id', () => {
    recordDeclinedWelcomeGroupId('group-1');
    recordDeclinedWelcomeGroupId('group-1');
    expect(get(declinedWelcomeGroupIds)).toEqual(['group-1']);
  });

  it('is idempotent across case and whitespace differences', () => {
    recordDeclinedWelcomeGroupId('group-1');
    recordDeclinedWelcomeGroupId('  GROUP-1  ');
    expect(get(declinedWelcomeGroupIds)).toEqual(['group-1']);
  });

  it('ignores empty or whitespace-only input', () => {
    recordDeclinedWelcomeGroupId('');
    recordDeclinedWelcomeGroupId('   ');
    expect(get(declinedWelcomeGroupIds)).toEqual([]);
  });
});
