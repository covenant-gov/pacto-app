import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../squad-hub-nav', () => ({
  restoreSquadsHubSelection: vi.fn(),
}));

const recoverMocks = vi.hoisted(() => ({
  recoverMissingSquadCatalog: vi.fn(async () => 0),
  enrichRecoveredSquadNamesFromInvites: vi.fn(async () => {}),
}));

vi.mock('./squad-catalog-recover', () => ({
  recoverMissingSquadCatalog: recoverMocks.recoverMissingSquadCatalog,
  enrichRecoveredSquadNamesFromInvites: recoverMocks.enrichRecoveredSquadNamesFromInvites,
}));

import { invoke } from '@tauri-apps/api/core';
import { restoreSquadsHubSelection } from '../squad-hub-nav';
import { squads } from '../../stores/squads';
import { squadNavOrder } from '../../stores/navigation';
import {
  hydrateSquadsFromDb,
  listSquads,
  persistCreatedSquad,
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
    recoverMocks.recoverMissingSquadCatalog.mockReset().mockResolvedValue(0);
    recoverMocks.enrichRecoveredSquadNamesFromInvites.mockReset().mockResolvedValue(undefined);
    squads.set([]);
    squadNavOrder.set([]);
  });

  afterEach(() => {
    squads.set([]);
    squadNavOrder.set([]);
  });

  it('hydrateSquadsFromDb loads rows from list_squads', async () => {
    vi.mocked(invoke).mockResolvedValue([sampleRow]);
    await hydrateSquadsFromDb();
    expect(invoke).toHaveBeenCalledWith('list_squads');
    expect(get(squads)).toHaveLength(1);
    expect(get(squads)[0]?.name).toBe('Alpha');
    expect(restoreSquadsHubSelection).toHaveBeenCalled();
  });

  it('hydrateSquadsFromDb seeds empty nav order by createdAt', async () => {
    vi.mocked(invoke).mockResolvedValue([
      { ...sampleRow, id: 'newer', createdAtMs: 200, updatedAtMs: 900 },
      { ...sampleRow, id: 'older', createdAtMs: 100, updatedAtMs: 50 },
    ]);
    squadNavOrder.set([]);
    await hydrateSquadsFromDb();
    expect(get(squadNavOrder)).toEqual(['older', 'newer']);
  });

  it('hydrateSquadsFromDb preserves manual order and appends newcomers', async () => {
    vi.mocked(invoke).mockResolvedValue([
      { ...sampleRow, id: 'a', createdAtMs: 1, updatedAtMs: 9 },
      { ...sampleRow, id: 'b', createdAtMs: 2, updatedAtMs: 8 },
      { ...sampleRow, id: 'c', createdAtMs: 3, updatedAtMs: 7 },
    ]);
    squadNavOrder.set(['c', 'gone', 'a']);
    await hydrateSquadsFromDb();
    expect(get(squadNavOrder)).toEqual(['c', 'a', 'b']);
  });

  it('persistSquad appends id to squadNavOrder', async () => {
    vi.mocked(invoke).mockResolvedValue(sampleRow);
    squadNavOrder.set(['other']);
    await persistSquad({
      id: 'squad-1',
      name: 'Alpha',
      channels: [{ name: 'announcements', groupId: 'g1', order: 0 }],
      kind: 'squad',
      createdAt: 1,
      updatedAt: 1,
    });
    expect(get(squadNavOrder)).toEqual(['other', 'squad-1']);
  });

  it('backfills default hub channel rows on hydrate', async () => {
    vi.mocked(invoke).mockResolvedValue([sampleRow]);
    await hydrateSquadsFromDb();
    const names = get(squads)[0]?.channels.map((c) => c.name);
    expect(names).toContain('announcements');
    expect(names).toContain('polls');
    expect(names).not.toContain('personal-alerts');
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
        { name: 'custom', groupId: 'custom-g', order: 3 },
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
    expect(get(squads)[0]?.channels).toHaveLength(3);
  });

  it('serializes persistSquadPatch per parent so the later patch sees the earlier store write', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let invokeCount = 0;
    vi.mocked(invoke).mockImplementation(async (_cmd, args) => {
      invokeCount += 1;
      const squad = (args as { squad?: { name?: string } } | undefined)?.squad;
      if (invokeCount === 1) await gate;
      return { ...sampleRow, name: squad?.name ?? sampleRow.name };
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
    const first = persistSquadPatch('squad-1', (s) => ({ ...s, name: 'One' }));
    const second = persistSquadPatch('squad-1', (s) => ({ ...s, name: `${s.name}-Two` }));
    release();
    await Promise.all([first, second]);
    expect(get(squads)[0]?.name).toBe('One-Two');
  });

  it('hydrateSquadsFromDb logs and clears when list_squads fails and recovery finds nothing', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    expect(errSpy).toHaveBeenCalled();
    expect(recoverMocks.recoverMissingSquadCatalog).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('hydrateSquadsFromDb keeps recovered squads when list_squads fails', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('db locked'));
    recoverMocks.recoverMissingSquadCatalog.mockImplementation(async () => {
      squads.set([
        {
          id: 'grp-ann',
          name: 'Alpha',
          channels: [{ name: 'announcements', groupId: 'grp-ann', order: 0 }],
          kind: 'squad',
          createdAt: 1,
          updatedAt: 1,
        },
      ]);
      return 1;
    });
    await hydrateSquadsFromDb();
    expect(get(squads)).toHaveLength(1);
    expect(get(squads)[0]?.id).toBe('grp-ann');
  });

  it('persistCreatedSquad keeps the temp id when upsert rejects', async () => {
    squads.set([
      {
        id: 'creating-squad-1',
        name: 'Alpha',
        channels: [],
        kind: 'squad',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    squadNavOrder.set(['creating-squad-1']);
    vi.mocked(invoke).mockRejectedValue(new Error('persist-failed'));
    await expect(
      persistCreatedSquad('creating-squad-1', {
        id: 'grp-real',
        name: 'Alpha',
        channels: [{ name: 'announcements', groupId: 'grp-real', order: 0 }],
        kind: 'squad',
        createdAt: 1,
        updatedAt: 1,
      }),
    ).rejects.toThrow('persist-failed');
    expect(get(squads).map((s) => s.id)).toEqual(['creating-squad-1']);
    expect(get(squadNavOrder)).toEqual(['creating-squad-1']);
  });

  it('persistCreatedSquad swaps the temp id after upsert succeeds', async () => {
    squads.set([
      {
        id: 'creating-squad-1',
        name: 'Alpha',
        channels: [],
        kind: 'squad',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    squadNavOrder.set(['creating-squad-1']);
    vi.mocked(invoke).mockResolvedValue({
      ...sampleRow,
      id: 'grp-real',
      channels: [
        { name: 'announcements', groupId: 'grp-real', order: 0 },
        { name: 'polls', groupId: 'grp-real', order: 1 },
      ],
    });
    await persistCreatedSquad('creating-squad-1', {
      id: 'grp-real',
      name: 'Alpha',
      channels: [{ name: 'announcements', groupId: 'grp-real', order: 0 }],
      kind: 'squad',
      createdAt: 1,
      updatedAt: 1,
    });
    expect(get(squads).map((s) => s.id)).toEqual(['grp-real']);
    expect(get(squadNavOrder)).toEqual(['grp-real']);
  });
});
