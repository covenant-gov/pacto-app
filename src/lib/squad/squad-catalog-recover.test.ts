import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../api/nostr', () => ({
  getMlsGroupMetadata: vi.fn(),
  parseSquadInviteMessage: vi.fn((content: string) => {
    try {
      const parsed = JSON.parse(content) as { type?: string; squadName?: string; groupId?: string };
      if (parsed.type === 'squad_invite' && parsed.squadName && parsed.groupId) {
        return parsed;
      }
    } catch {
      /* ignore */
    }
    return null;
  }),
}));

vi.mock('./squad-catalog', () => ({
  persistSquad: vi.fn(async (squad: { id: string }) => squad),
  persistSquadPatch: vi.fn(async (_id: string, patch: (s: unknown) => unknown) => patch({})),
}));

vi.mock('./squad-state-sync', () => ({
  maybeAutoRequestSquadStateSyncAfterJoin: vi.fn(async () => {}),
}));

import { getMlsGroupMetadata } from '../api/nostr';
import { persistSquad, persistSquadPatch } from './squad-catalog';
import { maybeAutoRequestSquadStateSyncAfterJoin } from './squad-state-sync';
import { backendDmMessages } from '../../stores/dm';
import { squads, type Squad } from '../../stores/squads';
import {
  collectInviteHintsFromMessages,
  enrichRecoveredSquadNamesFromInvites,
  fallbackRecoveredSquadName,
  planSquadCatalogRecovery,
  recoverMissingSquadCatalog,
} from './squad-catalog-recover';

function squad(id: string, name: string): Squad {
  return {
    id,
    name,
    channels: [{ name: 'announcements', groupId: id, order: 0 }],
    kind: 'squad',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('squad-catalog-recover', () => {
  beforeEach(() => {
    squads.set([]);
    backendDmMessages.set({});
    vi.mocked(getMlsGroupMetadata).mockReset();
    vi.mocked(persistSquad).mockReset().mockImplementation(async (s) => s as Squad);
    vi.mocked(persistSquadPatch).mockReset();
    vi.mocked(maybeAutoRequestSquadStateSyncAfterJoin).mockReset();
  });

  afterEach(() => {
    squads.set([]);
    backendDmMessages.set({});
  });

  it('plans a persist for live announcements groups missing from the catalog', () => {
    const planned = planSquadCatalogRecovery({
      listedIds: [],
      mlsGroups: [{ group_id: 'grp-ann', name: 'announcements' }],
      inviteHints: [{ groupId: 'grp-ann', squadName: 'Alpha' }],
    });
    expect(planned).toHaveLength(1);
    expect(planned[0]?.id).toBe('grp-ann');
    expect(planned[0]?.name).toBe('Alpha');
    expect(planned[0]?.channels.some((c) => c.name === 'announcements')).toBe(true);
    expect(planned[0]?.channels.some((c) => c.name === 'polls')).toBe(true);
  });

  it('uses a short id fallback instead of the MLS announcements label', () => {
    const planned = planSquadCatalogRecovery({
      listedIds: [],
      mlsGroups: [{ group_id: 'abcdef0123456789', name: 'announcements' }],
      inviteHints: [],
    });
    expect(planned[0]?.name).toBe(fallbackRecoveredSquadName('abcdef0123456789'));
    expect(planned[0]?.name).not.toBe('announcements');
  });

  it('skips already-listed, evicted, and custom-channel groups', () => {
    const planned = planSquadCatalogRecovery({
      listedIds: ['already'],
      mlsGroups: [
        { group_id: 'already', name: 'announcements' },
        { group_id: 'kicked', name: 'announcements', evicted: true },
        { group_id: 'custom', name: 'ops' },
      ],
      inviteHints: [{ groupId: 'custom', squadName: 'Should not insert' }],
    });
    expect(planned).toEqual([]);
  });

  it('does not plan a row from an invite-only hint with no live MLS group', () => {
    const planned = planSquadCatalogRecovery({
      listedIds: [],
      mlsGroups: [],
      inviteHints: [{ groupId: 'exited', squadName: 'Gone' }],
    });
    expect(planned).toEqual([]);
  });

  it('collectInviteHintsFromMessages reads squad_invite payloads', () => {
    const hints = collectInviteHintsFromMessages({
      npub1peer: [
        {
          content: JSON.stringify({ type: 'squad_invite', squadName: 'Alpha', groupId: 'g1' }),
        },
      ],
    });
    expect(hints.get('g1')?.squadName).toBe('Alpha');
  });

  it('recoverMissingSquadCatalog persists planned rows and requests state sync', async () => {
    vi.mocked(getMlsGroupMetadata).mockResolvedValue([
      { group_id: 'grp-ann', name: 'announcements' },
    ]);
    backendDmMessages.set({
      npub1peer: [
        {
          id: 'm1',
          content: JSON.stringify({ type: 'squad_invite', squadName: 'Alpha', groupId: 'grp-ann' }),
          at: 1,
          mine: true,
        } as never,
      ],
    });
    const inserted = await recoverMissingSquadCatalog();
    expect(inserted).toBe(1);
    expect(persistSquad).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'grp-ann', name: 'Alpha' }),
    );
    expect(maybeAutoRequestSquadStateSyncAfterJoin).toHaveBeenCalledWith('grp-ann');
  });

  it('recoverMissingSquadCatalog skips when metadata invoke fails', async () => {
    vi.mocked(getMlsGroupMetadata).mockRejectedValue(new Error('offline'));
    expect(await recoverMissingSquadCatalog()).toBe(0);
    expect(persistSquad).not.toHaveBeenCalled();
  });

  it('enrichRecoveredSquadNamesFromInvites patches fallback names only', async () => {
    const fallback = fallbackRecoveredSquadName('grp-ann');
    squads.set([squad('grp-ann', fallback), squad('kept', 'Kept')]);
    backendDmMessages.set({
      npub1peer: [
        {
          id: 'm1',
          content: JSON.stringify({ type: 'squad_invite', squadName: 'Alpha', groupId: 'grp-ann' }),
          at: 1,
          mine: true,
        } as never,
      ],
    });
    await enrichRecoveredSquadNamesFromInvites();
    expect(persistSquadPatch).toHaveBeenCalledTimes(1);
    expect(persistSquadPatch).toHaveBeenCalledWith('grp-ann', expect.any(Function));
  });

  it('enrichRecoveredSquadNamesFromInvites does not insert rows', async () => {
    squads.set([]);
    backendDmMessages.set({
      npub1peer: [
        {
          id: 'm1',
          content: JSON.stringify({ type: 'squad_invite', squadName: 'Alpha', groupId: 'missing' }),
          at: 1,
          mine: true,
        } as never,
      ],
    });
    await enrichRecoveredSquadNamesFromInvites();
    expect(persistSquad).not.toHaveBeenCalled();
    expect(persistSquadPatch).not.toHaveBeenCalled();
    expect(get(squads)).toEqual([]);
  });
});
