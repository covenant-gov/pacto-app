import { describe, expect, it } from 'vitest';
import { canBroadcastSquad, broadcastSquadRoleDeniedReason } from './permissions';

const squad = {
  id: 'group-1',
  name: 'Alpha',
  kind: 'squad' as const,
  visibility: 'public' as const,
  commonsTags: ['neo'],
};

describe('canBroadcastSquad', () => {
  it('stub allows broadcast for any user/squad', () => {
    expect(canBroadcastSquad({ userNpub: 'npub1', squad })).toBe(true);
    expect(broadcastSquadRoleDeniedReason({ userNpub: 'npub1', squad })).toBeNull();
  });
});
