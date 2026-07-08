import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/treasury-safes-cache', () => ({
  removeTreasurySafesCacheForParent: vi.fn(),
}));

vi.mock('../dashboard/squad-infra-cache', () => ({
  removeSquadInfraCacheForParent: vi.fn(),
}));

vi.mock('../dashboard/squad-member-evm-cache', () => ({
  removeSquadMemberEvmCacheForParent: vi.fn(),
}));

vi.mock('../dashboard/settings-chain-cache', () => ({
  removeSettingsChainCacheForParent: vi.fn(),
}));

import { removeTreasurySafesCacheForParent } from '../dashboard/treasury-safes-cache';
import { removeSquadInfraCacheForParent } from '../dashboard/squad-infra-cache';
import { removeSquadMemberEvmCacheForParent } from '../dashboard/squad-member-evm-cache';
import { removeSettingsChainCacheForParent } from '../dashboard/settings-chain-cache';
import { clearParentDashboardCaches } from './clear-parent-dashboard-caches';

describe('clearParentDashboardCaches', () => {
  beforeEach(() => {
    vi.mocked(removeTreasurySafesCacheForParent).mockReset();
    vi.mocked(removeSquadInfraCacheForParent).mockReset();
    vi.mocked(removeSquadMemberEvmCacheForParent).mockReset();
    vi.mocked(removeSettingsChainCacheForParent).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls all four dashboard cache removal helpers', () => {
    clearParentDashboardCaches('npub1test', 'parent-1');
    expect(removeTreasurySafesCacheForParent).toHaveBeenCalledWith('npub1test', 'parent-1');
    expect(removeSquadInfraCacheForParent).toHaveBeenCalledWith('npub1test', 'parent-1');
    expect(removeSquadMemberEvmCacheForParent).toHaveBeenCalledWith('npub1test', 'parent-1');
    expect(removeSettingsChainCacheForParent).toHaveBeenCalledWith('npub1test', 'parent-1');
  });

  it('returns early when npub is missing', () => {
    clearParentDashboardCaches(null, 'parent-1');
    expect(removeTreasurySafesCacheForParent).not.toHaveBeenCalled();
    expect(removeSquadInfraCacheForParent).not.toHaveBeenCalled();
    expect(removeSquadMemberEvmCacheForParent).not.toHaveBeenCalled();
    expect(removeSettingsChainCacheForParent).not.toHaveBeenCalled();
  });

  it('returns early when parentId is missing', () => {
    clearParentDashboardCaches('npub1test', '');
    expect(removeTreasurySafesCacheForParent).not.toHaveBeenCalled();
    expect(removeSquadInfraCacheForParent).not.toHaveBeenCalled();
    expect(removeSquadMemberEvmCacheForParent).not.toHaveBeenCalled();
    expect(removeSettingsChainCacheForParent).not.toHaveBeenCalled();
  });
});
