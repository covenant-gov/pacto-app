import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const persistSquadPatchMock = vi.fn();

vi.mock('../squad/squad-catalog', () => ({
  persistSquadPatch: (...args: unknown[]) => persistSquadPatchMock(...args),
  persistSquad: vi.fn(),
}));

import { handleChannelAddedToSquad } from './accept-invite';
import { squads, type Squad } from '../../stores/squads';

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
});
