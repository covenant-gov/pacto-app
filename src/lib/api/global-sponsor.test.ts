import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { listGlobalSponsoredFeeUsage } from './global-sponsor';

describe('listGlobalSponsoredFeeUsage', () => {
  it('invokes list_global_sponsored_fee_usage with optional limit', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await listGlobalSponsoredFeeUsage({ limit: 25 });
    expect(invoke).toHaveBeenCalledWith('list_global_sponsored_fee_usage', { limit: 25 });
  });
});
