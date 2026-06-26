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
import { activeSquadId } from '../../stores/navigation';
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
    currentNpubForPersistence.set('npub1test');
  });

  afterEach(() => {
    squads.set([]);
    activeSquadId.set(null);
    currentNpubForPersistence.set(null);
  });

  it('removes squad from store and deletes catalog row before leaving MLS groups', async () => {
    const onFailure = vi.fn();
    runExitParent({ squad, wasActive: true, previousChannelId: 'parent-1', onFailure });
    expect(get(squads)).toHaveLength(0);
    expect(get(activeSquadId)).toBeNull();
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
});
