import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/global-sponsor', () => ({
  listGlobalSponsoredFeeUsage: vi.fn(),
}));

import { listGlobalSponsoredFeeUsage } from '../api/global-sponsor';
import {
  globalFeeUsageLaneLabelKey,
  isKnownGlobalFeeUsageLane,
  loadGlobalSponsoredFeeUsage,
} from './global-sponsored-fee-usage';

describe('global-sponsored-fee-usage', () => {
  beforeEach(() => {
    vi.mocked(listGlobalSponsoredFeeUsage).mockReset();
  });

  it('maps known lanes to settings i18n keys', () => {
    expect(globalFeeUsageLaneLabelKey('factory')).toBe('settings.evmDashGas.lane.factory');
    expect(globalFeeUsageLaneLabelKey('gov_module')).toBe('settings.evmDashGas.lane.govModule');
    expect(globalFeeUsageLaneLabelKey('username_bootstrap')).toBe(
      'settings.evmDashGas.lane.usernameBootstrap',
    );
    expect(globalFeeUsageLaneLabelKey('username_member')).toBe(
      'settings.evmDashGas.lane.usernameMember',
    );
  });

  it('returns empty key for unknown lanes', () => {
    expect(globalFeeUsageLaneLabelKey('other')).toBe('');
    expect(isKnownGlobalFeeUsageLane('factory')).toBe(true);
    expect(isKnownGlobalFeeUsageLane('other')).toBe(false);
  });

  it('loadGlobalSponsoredFeeUsage forwards limit to the API', async () => {
    vi.mocked(listGlobalSponsoredFeeUsage).mockResolvedValueOnce([]);
    await loadGlobalSponsoredFeeUsage({ limit: 25 });
    expect(listGlobalSponsoredFeeUsage).toHaveBeenCalledWith({ limit: 25 });
  });
});
