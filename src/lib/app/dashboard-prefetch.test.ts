import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scheduleDashboardChannelPrefetch } from './dashboard-parent-prefetch';
import { scheduleDashboardPrefetch } from './dashboard-prefetch';

vi.mock('./dashboard-parent-prefetch', () => ({
  scheduleDashboardChannelPrefetch: vi.fn(),
}));

describe('scheduleDashboardPrefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to scheduleDashboardChannelPrefetch', () => {
    const parent = { id: 'parent-1', name: 'Test' } as unknown as Parameters<
      typeof scheduleDashboardPrefetch
    >[0];
    scheduleDashboardPrefetch(parent);
    expect(scheduleDashboardChannelPrefetch).toHaveBeenCalledWith(parent);
  });

  it('passes null through', () => {
    scheduleDashboardPrefetch(null);
    expect(scheduleDashboardChannelPrefetch).toHaveBeenCalledWith(null);
  });

  it('passes undefined through', () => {
    scheduleDashboardPrefetch(undefined);
    expect(scheduleDashboardChannelPrefetch).toHaveBeenCalledWith(undefined);
  });
});
