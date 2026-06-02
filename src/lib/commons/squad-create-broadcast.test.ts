import { describe, expect, it } from 'vitest';
import {
  defaultPublicSquadBroadcastMessage,
  isPublicSquadForCommonsBroadcast,
} from './squad-create-broadcast';

describe('isPublicSquadForCommonsBroadcast', () => {
  it('requires public visibility and tags', () => {
    expect(
      isPublicSquadForCommonsBroadcast({
        id: 'g1',
        name: 'Alpha',
        kind: 'squad',
        visibility: 'private',
        commonsTags: ['neo'],
      })
    ).toBe(false);
    expect(
      isPublicSquadForCommonsBroadcast({
        id: 'g1',
        name: 'Alpha',
        kind: 'squad',
        visibility: 'public',
      })
    ).toBe(false);
    expect(
      isPublicSquadForCommonsBroadcast({
        id: 'g1',
        name: 'Alpha',
        kind: 'squad',
        visibility: 'public',
        commonsTags: ['neo'],
      })
    ).toBe(true);
  });
});

describe('defaultPublicSquadBroadcastMessage', () => {
  it('uses squad name in default copy', () => {
    expect(defaultPublicSquadBroadcastMessage('Neo Builders')).toBe('New squad: Neo Builders');
  });
});
