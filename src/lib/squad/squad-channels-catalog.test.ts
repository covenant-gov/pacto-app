import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../api/nostr', () => ({
  sendDmMessage: vi.fn(),
  listPendingMlsWelcomes: vi.fn(),
  acceptMlsWelcome: vi.fn(),
}));

vi.mock('../parent-navbar', () => ({
  getAnnouncementsChannel: vi.fn(() => ({
    name: 'announcements',
    groupId: 'Ann-GID',
    order: 0,
  })),
}));

vi.mock('./squad-catalog', () => ({
  persistSquadPatch: vi.fn(async (parentId: string, patch: (s: Squad) => Squad) => {
    const { squads } = await import('../../stores/squads');
    const current = get(squads).find((s) => s.id === parentId);
    if (!current) return null;
    const next = patch(current);
    squads.update((list) => list.map((s) => (s.id === parentId ? next : s)));
    return next;
  }),
}));

vi.mock('../../stores/squads', async () => {
  const { writable } = await import('svelte/store');
  const parent = {
    id: 'ann-gid',
    name: 'h2',
    channels: [
      { name: 'announcements', groupId: 'ann-gid', order: 0 },
      { name: 'polls', groupId: 'ann-gid', order: 1 },
    ],
    kind: 'squad' as const,
    createdAt: 1,
    updatedAt: 1,
  };
  return { squads: writable([parent]) };
});

import { sendDmMessage, listPendingMlsWelcomes, acceptMlsWelcome } from '../api/nostr';
import { persistSquadPatch } from './squad-catalog';
import { squads, type Squad } from '../../stores/squads';
import {
  applySquadChannelsCatalog,
  formatSquadChannelsCatalog,
  parseSquadChannelsCatalog,
  publishSquadChannelsCatalog,
} from './squad-channels-catalog';

describe('squad-channels-catalog', () => {
  beforeEach(() => {
    vi.mocked(sendDmMessage).mockReset().mockResolvedValue(true);
    vi.mocked(listPendingMlsWelcomes).mockReset().mockResolvedValue([]);
    vi.mocked(acceptMlsWelcome).mockReset().mockResolvedValue(true);
    vi.mocked(persistSquadPatch).mockClear();
    squads.set([
      {
        id: 'ann-gid',
        name: 'h2',
        channels: [
          { name: 'announcements', groupId: 'ann-gid', order: 0 },
          { name: 'polls', groupId: 'ann-gid', order: 1 },
        ],
        kind: 'squad',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it('parses catalog and matches parent_id case-insensitively on apply', async () => {
    const raw = formatSquadChannelsCatalog({
      parent_id: 'ANN-GID',
      channels: [
        { name: 'x', groupId: 'g-x', order: 2, access: 'open' },
        { name: 'y', groupId: 'g-y', order: 3, access: 'open' },
      ],
    });
    expect(parseSquadChannelsCatalog(raw)?.channels).toHaveLength(2);

    applySquadChannelsCatalog(raw, 'ann-gid');
    await vi.waitFor(() => {
      expect(get(squads)[0]?.channels.some((c) => c.name === 'x')).toBe(true);
    });
    expect(get(squads)[0]?.channels.map((c) => c.name)).toEqual(
      expect.arrayContaining(['announcements', 'polls', 'x', 'y']),
    );
  });

  it('publish includes legacy channels without access as open', async () => {
    squads.set([
      {
        id: 'ann-gid',
        name: 'h2',
        channels: [
          { name: 'announcements', groupId: 'ann-gid', order: 0 },
          { name: 'z', groupId: 'g-z', order: 2 },
          { name: 'secret', groupId: 'g-sec', order: 3, access: 'closed' },
        ],
        kind: 'squad',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    await publishSquadChannelsCatalog(get(squads)[0]!);
    expect(sendDmMessage).toHaveBeenCalled();
    const body = vi.mocked(sendDmMessage).mock.calls[0][1] as string;
    const parsed = parseSquadChannelsCatalog(body);
    expect(parsed?.channels).toEqual([{ name: 'z', groupId: 'g-z', order: 2, access: 'open' }]);
  });

  it('parseSquadChannelsCatalog rejects bad envelopes and skips bad rows', () => {
    expect(parseSquadChannelsCatalog(null)).toBeNull();
    expect(parseSquadChannelsCatalog('plain')).toBeNull();
    expect(parseSquadChannelsCatalog('{')).toBeNull();
    expect(parseSquadChannelsCatalog(JSON.stringify({ type: 'other' }))).toBeNull();
    expect(
      parseSquadChannelsCatalog(JSON.stringify({ type: 'squad_channels_catalog', payload: {} })),
    ).toBeNull();

    const parsed = parseSquadChannelsCatalog(
      JSON.stringify({
        type: 'squad_channels_catalog',
        payload: {
          parent_id: ' ann-gid ',
          channels: [
            null,
            { name: 'announcements', groupId: 'x', order: 0, access: 'open' },
            { name: 'polls', groupId: 'x', order: 1, access: 'open' },
            { name: '', groupId: 'g1', order: 2 },
            { name: 'ok', groupId: '', order: 3 },
            { name: 'closed-row', groupId: 'g-c', order: 4, access: 'closed' },
            { name: 'open-row', groupId: 'g-o', access: 'open' },
          ],
        },
      }),
    );
    expect(parsed).toEqual({
      parent_id: 'ann-gid',
      channels: [
        { name: 'closed-row', groupId: 'g-c', order: 4, access: 'closed' },
        { name: 'open-row', groupId: 'g-o', order: 1, access: 'open' },
      ],
    });
  });

  it('apply ignores mismatched parent and accepts matching welcomes', async () => {
    const raw = formatSquadChannelsCatalog({
      parent_id: 'ann-gid',
      channels: [{ name: 'ops', groupId: 'g-ops', order: 2, access: 'open' }],
    });
    applySquadChannelsCatalog(raw, 'other');
    expect(persistSquadPatch).not.toHaveBeenCalled();

    vi.mocked(listPendingMlsWelcomes).mockResolvedValue([
      {
        id: 'w1',
        wrapper_event_id: 'e1',
        nostr_group_id: 'G-OPS',
        group_name: 'ops',
        group_description: null,
        group_admin_pubkeys: [],
        group_relays: [],
        welcomer: 'npub1x',
        member_count: 1,
      },
    ]);
    applySquadChannelsCatalog(raw, 'ann-gid');
    await vi.waitFor(() => {
      expect(acceptMlsWelcome).toHaveBeenCalledWith('w1');
    });
  });
});
