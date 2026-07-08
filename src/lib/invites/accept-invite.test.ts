import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const persistSquadPatchMock = vi.fn();

vi.mock('../squad/squad-catalog', () => ({
  persistSquadPatch: (...args: unknown[]) => persistSquadPatchMock(...args),
  persistSquad: vi.fn(),
}));

import { handleChannelAddedToSquad, reconcileStaleInviteDecisions, squadInviteResolvedByMembership } from './accept-invite';
import { squads, type Squad } from '../../stores/squads';
import { acceptedSquadInviteIds } from '../../stores/invite-decisions';
import { pactoAppInboxMessages } from '../../stores/dm';

const parent: Squad = {
  id: 'parent-1',
  name: 'Alpha',
  channels: [{ name: 'announcements', groupId: 'parent-1', order: 0 }],
  kind: 'squad',
  createdAt: 1,
  updatedAt: 1,
};

describe('accept-invite channel persistence', () => {
  beforeEach(() => {
    persistSquadPatchMock.mockReset().mockResolvedValue(parent);
    squads.set([parent]);
  });

  it('handleChannelAddedToSquad persists merged channels', () => {
    handleChannelAddedToSquad('parent-1', 'chan-new', 'general');
    expect(persistSquadPatchMock).toHaveBeenCalledWith('parent-1', expect.any(Function));
    const patch = persistSquadPatchMock.mock.calls[0]![1] as (s: Squad) => Squad;
    const patched = patch(parent);
    expect(patched.channels).toHaveLength(2);
    expect(patched.channels[1]).toEqual({
      name: 'general',
      groupId: 'chan-new',
      order: 1,
    });
  });

  it('skips duplicate channel group ids', () => {
    squads.set([
      {
        ...parent,
        channels: [
          ...parent.channels,
          { name: 'general', groupId: 'chan-new', order: 1 },
        ],
      },
    ]);
    handleChannelAddedToSquad('parent-1', 'chan-new', 'general');
    const patch = persistSquadPatchMock.mock.calls[0]![1] as (s: Squad) => Squad;
    const patched = patch(get(squads)[0]!);
    expect(patched.channels).toHaveLength(2);
  });

  it('detects squad invite resolved when squad is already local', () => {
    expect(squadInviteResolvedByMembership('parent-1')).toBe(true);
    expect(squadInviteResolvedByMembership('missing')).toBe(false);
  });

  it('reconcileStaleInviteDecisions marks inbox invites for joined squads', () => {
    acceptedSquadInviteIds.set([]);
    pactoAppInboxMessages.set([
      {
        id: 'invite-msg-1',
        content: JSON.stringify({
          type: 'squad_invite',
          squadName: 'Alpha',
          groupId: 'parent-1',
        }),
        at: 1,
        mine: false,
        inviterNpub: 'npub1inviter',
      },
    ]);
    reconcileStaleInviteDecisions();
    expect(get(acceptedSquadInviteIds)).toEqual(['invite-msg-1']);
  });
});
