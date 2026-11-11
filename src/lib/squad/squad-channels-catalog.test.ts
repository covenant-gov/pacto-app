import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { requireMySquadPrivilege } = vi.hoisted(() => ({
  requireMySquadPrivilege: vi.fn(async (_parentId: string, _action: string) => ({
    ok: true as const,
    active: false,
    flags: null,
  })),
}));

vi.mock('../governance/squad-privilege-enforce', () => ({
  requireMySquadPrivilege: (parentId: string, action: string) =>
    requireMySquadPrivilege(parentId, action),
}));

const tryCompleteOpenChannelJoins = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../api/nostr', () => ({
  sendDmMessage: vi.fn(),
  listPendingMlsWelcomes: vi.fn(),
  acceptMlsWelcome: vi.fn(),
  listMlsGroups: vi.fn(),
}));

vi.mock('./open-channel-join', () => ({
  tryCompleteOpenChannelJoins: (...args: unknown[]) => tryCompleteOpenChannelJoins(...args),
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

import { sendDmMessage } from '../api/nostr';
import { persistSquadPatch } from './squad-catalog';
import { squads, type Squad } from '../../stores/squads';
import { resetMlsHistoryWelcomeForTests } from '../../stores/mls-history-welcome';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  pendingOpenChannelJoins,
  resetPendingOpenChannelJoins,
  upsertPendingOpenChannelJoin,
} from './pending-open-channel-joins';
import {
  applySquadChannelsCatalog,
  formatSquadChannelsCatalog,
  parseSquadChannelsCatalog,
  publishSquadChannelsCatalog,
} from './squad-channels-catalog';

describe('squad-channels-catalog', () => {
  beforeEach(() => {
    resetMlsHistoryWelcomeForTests();
    setCurrentNpubForPersistence('npub1test');
    vi.mocked(sendDmMessage).mockReset().mockResolvedValue(true);
    requireMySquadPrivilege.mockReset();
    requireMySquadPrivilege.mockResolvedValue({ ok: true, active: false, flags: null });
    tryCompleteOpenChannelJoins.mockReset().mockResolvedValue(undefined);
    resetPendingOpenChannelJoins();
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

  afterEach(() => {
    resetMlsHistoryWelcomeForTests();
    resetPendingOpenChannelJoins();
    setCurrentNpubForPersistence(null);
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
      expect(get(pendingOpenChannelJoins).map((row) => row.groupId)).toEqual(
        expect.arrayContaining(['g-x', 'g-y']),
      );
    });
    expect(get(squads)[0]?.channels.map((c) => c.name)).toEqual(['announcements', 'polls']);
    expect(tryCompleteOpenChannelJoins).toHaveBeenCalled();
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

  it('does not send the catalog when createChannel is denied', async () => {
    requireMySquadPrivilege.mockResolvedValueOnce({
      ok: false,
      reason: 'denied',
      active: true,
    } as never);
    const sent = await publishSquadChannelsCatalog(get(squads)[0]!);
    expect(sent).toBe(false);
    expect(sendDmMessage).not.toHaveBeenCalled();
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

  it('apply ignores mismatched parent and drains matching catalog rows', async () => {
    const raw = formatSquadChannelsCatalog({
      parent_id: 'ann-gid',
      channels: [{ name: 'ops', groupId: 'g-ops', order: 2, access: 'open' }],
    });
    applySquadChannelsCatalog(raw, 'other');
    expect(persistSquadPatch).not.toHaveBeenCalled();

    applySquadChannelsCatalog(raw, 'ann-gid');
    await vi.waitFor(() => {
      expect(tryCompleteOpenChannelJoins).toHaveBeenCalled();
    });
    expect(get(pendingOpenChannelJoins)[0]?.groupId).toBe('g-ops');
    expect(get(squads)[0]?.channels.some((c) => c.name === 'ops')).toBe(false);
  });

  it('apply stores no wanted row for a channel already on the parent', async () => {
    squads.set([
      {
        id: 'ann-gid',
        name: 'h2',
        channels: [
          { name: 'announcements', groupId: 'ann-gid', order: 0 },
          { name: 'ops', groupId: 'G-OPS', order: 2, access: 'open' },
        ],
        kind: 'squad',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    const raw = formatSquadChannelsCatalog({
      parent_id: 'ann-gid',
      channels: [
        { name: 'ops', groupId: 'g-ops', order: 2, access: 'open' },
        { name: 'new', groupId: 'g-new', order: 3, access: 'open' },
      ],
    });
    applySquadChannelsCatalog(raw, 'ann-gid');
    await vi.waitFor(() => {
      expect(tryCompleteOpenChannelJoins).toHaveBeenCalled();
    });
    expect(get(pendingOpenChannelJoins).map((row) => row.groupId)).toEqual(['g-new']);
  });

  it('apply forgets wanted rows the catalog no longer lists', async () => {
    upsertPendingOpenChannelJoin({
      parentId: 'ann-gid',
      groupId: 'g-gone',
      name: 'gone',
      access: 'open',
    });
    upsertPendingOpenChannelJoin({
      parentId: 'other-parent',
      groupId: 'g-other',
      name: 'other',
      access: 'open',
    });
    const raw = formatSquadChannelsCatalog({
      parent_id: 'ann-gid',
      channels: [{ name: 'ops', groupId: 'g-ops', order: 2, access: 'open' }],
    });
    applySquadChannelsCatalog(raw, 'ann-gid');
    await vi.waitFor(() => {
      expect(tryCompleteOpenChannelJoins).toHaveBeenCalled();
    });
    expect(get(pendingOpenChannelJoins).map((row) => row.groupId).sort()).toEqual([
      'g-ops',
      'g-other',
    ]);
  });
});
