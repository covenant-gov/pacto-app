import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import { squads, type Squad } from '../../stores/squads';
import type { PendingMlsWelcome } from '../api/nostr';

const acceptStagedChannelWelcome = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const attachChannelToParent = vi.hoisted(() => vi.fn());

vi.mock('../invites/accept-invite', () => ({
  acceptStagedChannelWelcome: (...args: unknown[]) => acceptStagedChannelWelcome(...args),
  attachChannelToParent: (...args: unknown[]) => attachChannelToParent(...args),
  sameMlsGroupId: (left: string, right: string) =>
    left.trim().toLowerCase() === right.trim().toLowerCase(),
}));

vi.mock('../api/nostr', () => ({
  listPendingMlsWelcomes: vi.fn(),
  listMlsGroups: vi.fn(),
}));

import { listMlsGroups, listPendingMlsWelcomes } from '../api/nostr';
import {
  openChannelJoinTarget,
  tryCompleteOpenChannelJoins,
} from './open-channel-join';
import {
  pendingOpenChannelJoins,
  resetPendingOpenChannelJoins,
  upsertPendingOpenChannelJoin,
} from './pending-open-channel-joins';

function parentSquad(overrides: Partial<Squad> = {}): Squad {
  return {
    id: 'ann-gid',
    name: 'Crew',
    channels: [
      { name: 'announcements', groupId: 'ann-gid', order: 0 },
      { name: 'polls', groupId: 'ann-gid', order: 1 },
    ],
    kind: 'squad',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function welcome(overrides: Partial<PendingMlsWelcome> = {}): PendingMlsWelcome {
  return {
    id: 'w-c1',
    wrapper_event_id: 'wrap-c1',
    nostr_group_id: 'g-c1',
    group_name: 'c1',
    group_description: null,
    group_admin_pubkeys: [],
    group_relays: [],
    welcomer: 'npub1admit',
    member_count: 2,
    ...overrides,
  };
}

describe('open-channel-join', () => {
  beforeEach(() => {
    setCurrentNpubForPersistence('npub1joiner');
    resetPendingOpenChannelJoins();
    acceptStagedChannelWelcome.mockReset().mockResolvedValue(undefined);
    attachChannelToParent.mockReset();
    vi.mocked(listPendingMlsWelcomes).mockReset().mockResolvedValue([]);
    vi.mocked(listMlsGroups).mockReset().mockResolvedValue(['ann-gid']);
    squads.set([parentSquad()]);
  });

  afterEach(() => {
    resetPendingOpenChannelJoins();
    setCurrentNpubForPersistence(null);
  });

  it('stores wanted rows without attaching when no welcome is pending', async () => {
    upsertPendingOpenChannelJoin({
      parentId: 'ann-gid',
      groupId: 'g-c1',
      name: 'c1',
      access: 'open',
    });
    await tryCompleteOpenChannelJoins();
    expect(acceptStagedChannelWelcome).not.toHaveBeenCalled();
    expect(attachChannelToParent).not.toHaveBeenCalled();
    expect(get(pendingOpenChannelJoins)).toHaveLength(1);
    expect(get(squads)[0]?.channels.some((c) => c.name === 'c1')).toBe(false);
  });

  it('accepts a later channel welcome onto the existing parent', async () => {
    upsertPendingOpenChannelJoin({
      parentId: 'ann-gid',
      groupId: 'g-c1',
      name: 'c1',
      access: 'open',
    });
    vi.mocked(listPendingMlsWelcomes).mockResolvedValue([welcome({ nostr_group_id: 'G-C1' })]);
    await tryCompleteOpenChannelJoins('g-c1');
    expect(acceptStagedChannelWelcome).toHaveBeenCalledWith({
      welcomeId: 'w-c1',
      channelGroupId: 'G-C1',
      parentId: 'ann-gid',
      channelName: 'c1',
      access: 'open',
    });
    expect(get(pendingOpenChannelJoins)).toEqual([]);
  });

  it('heals a ghost sidebar row when a pending welcome still exists', async () => {
    squads.set([
      parentSquad({
        channels: [
          { name: 'announcements', groupId: 'ann-gid', order: 0 },
          { name: 'c1', groupId: 'g-c1', order: 2, access: 'open' },
        ],
      }),
    ]);
    vi.mocked(listPendingMlsWelcomes).mockResolvedValue([welcome()]);
    await tryCompleteOpenChannelJoins();
    expect(acceptStagedChannelWelcome).toHaveBeenCalledWith(
      expect.objectContaining({
        welcomeId: 'w-c1',
        parentId: 'ann-gid',
        channelName: 'c1',
      }),
    );
  });

  it('attaches when already an MLS member and forgets the wanted row', async () => {
    upsertPendingOpenChannelJoin({
      parentId: 'ann-gid',
      groupId: 'g-c1',
      name: 'c1',
      access: 'open',
    });
    vi.mocked(listMlsGroups).mockResolvedValue(['ann-gid', 'g-c1']);
    await tryCompleteOpenChannelJoins();
    expect(acceptStagedChannelWelcome).not.toHaveBeenCalled();
    expect(attachChannelToParent).toHaveBeenCalledWith('ann-gid', 'g-c1', 'c1', 'open');
    expect(get(pendingOpenChannelJoins)).toEqual([]);
  });

  it('does not treat a local channel as a new squad target', () => {
    upsertPendingOpenChannelJoin({
      parentId: 'ann-gid',
      groupId: 'g-c1',
      name: 'c1',
      access: 'open',
    });
    expect(openChannelJoinTarget('G-C1')).toMatchObject({
      parentId: 'ann-gid',
      name: 'c1',
    });
    expect(openChannelJoinTarget('ann-gid')).toBeNull();
  });
});
