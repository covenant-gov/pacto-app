import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../api/nostr', () => ({
  leaveMlsGroup: vi.fn(),
}));

vi.mock('../squad/squad-catalog', () => ({
  deleteSquad: vi.fn(),
  persistSquad: vi.fn(),
}));

vi.mock('./clear-parent-dashboard-caches', () => ({
  clearParentDashboardCaches: vi.fn(),
}));

import { leaveMlsGroup } from '../api/nostr';
import { deleteSquad, persistSquad } from '../squad/squad-catalog';
import { clearParentDashboardCaches } from './clear-parent-dashboard-caches';
import { runExitParent } from './exit-parent-flow';
import { squads, type Squad } from '../../stores/squads';
import {
  activeSquadId,
  activeChannelId,
  activeHubChannelName,
} from '../../stores/navigation';
import { currentNpubForPersistence } from '../../stores/persistence-context';

const squad: Squad = {
  id: 'parent-1',
  name: 'Alpha',
  channels: [
    { name: 'announcements', groupId: 'parent-1', order: 0 },
    { name: 'general', groupId: 'chan-2', order: 1 },
  ],
  kind: 'squad',
  createdAt: 1,
  updatedAt: 1,
};

describe('runExitParent', () => {
  beforeEach(() => {
    vi.mocked(deleteSquad).mockReset().mockResolvedValue(undefined);
    vi.mocked(persistSquad).mockReset().mockResolvedValue(squad);
    vi.mocked(leaveMlsGroup).mockReset().mockResolvedValue(undefined);
    vi.mocked(clearParentDashboardCaches).mockReset();
    squads.set([squad]);
    activeSquadId.set(squad.id);
    activeChannelId.set('parent-1');
    activeHubChannelName.set('announcements');
    currentNpubForPersistence.set('npub1test');
  });

  afterEach(() => {
    squads.set([]);
    activeSquadId.set(null);
    activeChannelId.set(null);
    activeHubChannelName.set(null);
    currentNpubForPersistence.set(null);
  });

  it('removes squad from store and deletes catalog row before leaving MLS groups', async () => {
    const onFailure = vi.fn();
    runExitParent({ squad, wasActive: true, previousChannelId: 'parent-1', onFailure });
    expect(get(squads)).toHaveLength(0);
    expect(get(activeSquadId)).toBeNull();
    expect(get(activeChannelId)).toBeNull();
    expect(get(activeHubChannelName)).toBeNull();
    await vi.waitFor(() => {
      expect(deleteSquad).toHaveBeenCalledWith('parent-1');
    });
    expect(clearParentDashboardCaches).toHaveBeenCalledWith('npub1test', 'parent-1');
    await vi.waitFor(() => {
      expect(leaveMlsGroup).toHaveBeenCalledTimes(2);
    });
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('reverts catalog and store when MLS leave fails', async () => {
    vi.mocked(leaveMlsGroup).mockRejectedValueOnce(new Error('network'));
    const onFailure = vi.fn();
    runExitParent({ squad, wasActive: true, previousChannelId: 'parent-1', onFailure });
    await vi.waitFor(() => {
      expect(onFailure).toHaveBeenCalled();
    });
    expect(persistSquad).toHaveBeenCalledWith(squad);
    expect(get(squads)).toHaveLength(1);
    expect(get(squads)[0]?.id).toBe('parent-1');
    expect(get(activeSquadId)).toBe('parent-1');
  });

  it('does not touch active navigation when wasActive is false', async () => {
    activeSquadId.set('other-parent');
    activeChannelId.set('other-channel');
    activeHubChannelName.set('other');
    const onFailure = vi.fn();

    runExitParent({ squad, wasActive: false, previousChannelId: null, onFailure });

    expect(get(squads)).toHaveLength(0);
    expect(get(activeSquadId)).toBe('other-parent');
    expect(get(activeChannelId)).toBe('other-channel');
    expect(get(activeHubChannelName)).toBe('other');
    await vi.waitFor(() => {
      expect(deleteSquad).toHaveBeenCalledWith('parent-1');
    });
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('leaves no channels when the squad has none', async () => {
    const emptySquad: Squad = { ...squad, channels: [] };
    squads.set([emptySquad]);
    const onFailure = vi.fn();
    runExitParent({ squad: emptySquad, wasActive: true, previousChannelId: null, onFailure });
    expect(get(squads)).toHaveLength(0);
    await vi.waitFor(() => {
      expect(deleteSquad).toHaveBeenCalledWith('parent-1');
    });
    expect(leaveMlsGroup).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('reverts store even when persistSquad revert fails', async () => {
    vi.mocked(deleteSquad).mockRejectedValueOnce(new Error('db-locked'));
    vi.mocked(persistSquad).mockRejectedValueOnce(new Error('persist-failed'));
    const onFailure = vi.fn();
    runExitParent({ squad, wasActive: true, previousChannelId: 'parent-1', onFailure });
    await vi.waitFor(() => {
      expect(onFailure).toHaveBeenCalledWith('db-locked');
    });
    expect(persistSquad).toHaveBeenCalledWith(squad);
    expect(get(squads)).toHaveLength(1);
    expect(get(squads)[0]?.id).toBe('parent-1');
    expect(get(activeSquadId)).toBe('parent-1');
  });
});
