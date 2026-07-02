import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Squad } from '../../stores/squads';

const syncTreasury = vi.fn().mockResolvedValue(undefined);
const syncInfra = vi.fn().mockResolvedValue(undefined);
const syncMemberEvm = vi.fn().mockResolvedValue(undefined);
const replayAutomation = vi.fn().mockResolvedValue(undefined);

vi.mock('../api/nostr', () => ({
  replayMlsAutomationSideEffects: (...args: unknown[]) => replayAutomation(...args),
}));

vi.mock('../dashboard/dashboard-data-sync', () => ({
  syncTreasurySafesForParent: (...args: unknown[]) => syncTreasury(...args),
  syncSquadInfraForParent: (...args: unknown[]) => syncInfra(...args),
  syncSquadMemberEvmForParent: (...args: unknown[]) => syncMemberEvm(...args),
  resetDashboardDataSyncInflight: vi.fn(),
}));

import {
  resetDashboardPrefetchSession,
  scheduleHubParentPrefetch,
  scheduleDashboardChannelPrefetch,
} from './dashboard-parent-prefetch';

function mockSquad(id: string): Squad {
  return {
    id,
    name: 'Test',
    channels: [{ name: 'announcements', groupId: 'gid-1', order: 0 }],
    kind: 'squad',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('dashboard-parent-prefetch', () => {
  beforeEach(() => {
    resetDashboardPrefetchSession();
    syncTreasury.mockClear();
    syncInfra.mockClear();
    syncMemberEvm.mockClear();
    replayAutomation.mockClear();
  });

  it('prefetches once per parent per session', async () => {
    const parent = mockSquad('p1');
    scheduleHubParentPrefetch(parent);
    scheduleHubParentPrefetch(parent);
    scheduleDashboardChannelPrefetch(parent);
    await vi.waitFor(() => {
      expect(replayAutomation).toHaveBeenCalledTimes(1);
      expect(syncTreasury).toHaveBeenCalledTimes(1);
      expect(syncInfra).toHaveBeenCalledTimes(1);
      expect(syncMemberEvm).toHaveBeenCalledTimes(1);
    });
  });
});
