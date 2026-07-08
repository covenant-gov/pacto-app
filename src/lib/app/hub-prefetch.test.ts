import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scheduleHubParentPrefetch } from './dashboard-parent-prefetch';
import { scheduleHubPrefetch } from './hub-prefetch';

vi.mock('./dashboard-parent-prefetch', () => ({
  scheduleHubParentPrefetch: vi.fn(),
}));

describe('scheduleHubPrefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to scheduleHubParentPrefetch', () => {
    const parent = { id: 'parent-1', name: 'Test' } as unknown as Parameters<
      typeof scheduleHubPrefetch
    >[0];
    scheduleHubPrefetch(parent);
    expect(scheduleHubParentPrefetch).toHaveBeenCalledWith(parent);
  });

  it('passes null through', () => {
    scheduleHubPrefetch(null);
    expect(scheduleHubParentPrefetch).toHaveBeenCalledWith(null);
  });

  it('passes undefined through', () => {
    scheduleHubPrefetch(undefined);
    expect(scheduleHubParentPrefetch).toHaveBeenCalledWith(undefined);
  });
});
