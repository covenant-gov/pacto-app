import { describe, expect, it } from 'vitest';
import { normalizeStoredChannel } from './squads';

describe('normalizeStoredChannel', () => {
  it('trims channel names', () => {
    expect(normalizeStoredChannel({ name: ' announcements ', groupId: 'g1', order: 0 })).toEqual({
      name: 'announcements',
      groupId: 'g1',
      order: 0,
    });
  });
});
