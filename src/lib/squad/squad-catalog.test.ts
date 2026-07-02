import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../squad-hub-nav', () => ({
  restoreSquadsHubSelection: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { restoreSquadsHubSelection } from '../squad-hub-nav';
import { squads, DASHBOARD_CHANNEL_ID } from '../../stores/squads';
import {
  hydrateSquadsFromDb,
  listSquads,
  persistSquad,
  persistSquadPatch,
  upsertSquad,
} from './squad-catalog';

const sampleRow = {
  id: 'squad-1',
  name: 'Alpha',
  channels: [{ name: 'announcements', groupId: 'g1', order: 0 }],
  kind: 'squad',
  visibility: 'private',
  createdAtMs: 1,
  updatedAtMs: 1,
};

describe('squad-catalog', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(restoreSquadsHubSelection).mockReset();
    squads.set([]);
  });

  afterEach(() => {
    squads.set([]);
  });

  it('hydrateSquadsFromDb loads rows from list_squads', async () => {
    vi.mocked(invoke).mockResolvedValue([sampleRow]);
    await hydrateSquadsFromDb();
    expect(invoke).toHaveBeenCalledWith('list_squads');
    expect(get(squads)).toHaveLength(1);
    expect(get(squads)[0]?.name).toBe('Alpha');
    expect(restoreSquadsHubSelection).toHaveBeenCalled();
  });

  it('backfills default hub channel rows on hydrate', async () => {
    vi.mocked(invoke).mockResolvedValue([sampleRow]);
    await hydrateSquadsFromDb();
    const names = get(squads)[0]?.channels.map((c) => c.name);
    expect(names).toContain('personal-alerts');
    expect(names).toContain('polls');
  });

  it('skips malformed rows without dropping valid squads', async () => {
    vi.mocked(invoke).mockResolvedValue([sampleRow, { bad: true }]);
    const loaded = await listSquads();
    expect(loaded).toHaveLength(1);
  });

  it('upsertSquad invokes backend with camelCase payload', async () => {
    vi.mocked(invoke).mockResolvedValue(sampleRow);
    const squad = get(squads)[0] ?? {
      id: 'squad-1',
      name: 'Alpha',
      channels: [{ name: 'announcements', groupId: 'g1', order: 0 }],
      kind: 'squad' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    await upsertSquad(squad);
    expect(invoke).toHaveBeenCalledWith('upsert_squad', {
      squad: expect.objectContaining({
        id: 'squad-1',
        createdAtMs: 1,
        updatedAtMs: 1,
      }),
    });
  });

  it('persistSquad merges normalized row into the store', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ...sampleRow,
      channels: [
        { name: 'announcements', groupId: 'g1', order: 0 },
        { name: 'personal-alerts', groupId: 'g1', order: 1 },
        { name: 'polls', groupId: 'g1', order: 2 },
        { name: 'dashboard', groupId: DASHBOARD_CHANNEL_ID, order: 3 },
      ],
    });
    squads.set([
      {
        id: 'squad-1',
        name: 'Old',
        channels: [],
        kind: 'squad',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    const saved = await persistSquad(get(squads)[0]!);
    expect(saved.name).toBe('Alpha');
    expect(get(squads)[0]?.name).toBe('Alpha');
  });

  it('persistSquadPatch invokes upsert with patched channels', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ...sampleRow,
      channels: [
        { name: 'announcements', groupId: 'g1', order: 0 },
        { name: 'general', groupId: 'g2', order: 1 },
      ],
    });
    squads.set([
      {
        id: 'squad-1',
        name: 'Alpha',
        channels: [{ name: 'announcements', groupId: 'g1', order: 0 }],
        kind: 'squad',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    await persistSquadPatch('squad-1', (s) => ({
      ...s,
      channels: [...s.channels, { name: 'general', groupId: 'g2', order: 1 }],
    }));
    expect(invoke).toHaveBeenCalledWith('upsert_squad', expect.any(Object));
    expect(get(squads)[0]?.channels).toHaveLength(4);
  });

  it('hydrateSquadsFromDb clears squads on invoke failure', async () => {
    squads.set([
      {
        id: 'stale',
        name: 'Stale',
        channels: [],
        kind: 'squad',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    vi.mocked(invoke).mockRejectedValue(new Error('db locked'));
    await hydrateSquadsFromDb();
    expect(get(squads)).toEqual([]);
  });
});
