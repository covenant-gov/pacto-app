import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSquadEventCardRowsCache, squadEventRowsForCards } from './squad-event-card-replica';

const mocks = vi.hoisted(() => ({ listSquadEvents: vi.fn() }));

vi.mock('../api/squad-events', () => ({ listSquadEvents: mocks.listSquadEvents }));

describe('squadEventRowsForCards', () => {
  beforeEach(() => {
    clearSquadEventCardRowsCache();
    mocks.listSquadEvents.mockReset().mockResolvedValue([]);
  });

  it('shares one read per parent and nonce, and reads again on a new nonce', async () => {
    await squadEventRowsForCards('p1', 0);
    await squadEventRowsForCards('p1', 0);
    expect(mocks.listSquadEvents).toHaveBeenCalledTimes(1);
    await squadEventRowsForCards('p1', 1);
    expect(mocks.listSquadEvents).toHaveBeenCalledTimes(2);
  });

  it('returns null on a failed read and retries next time', async () => {
    mocks.listSquadEvents.mockRejectedValueOnce(new Error('offline'));
    expect(await squadEventRowsForCards('p1', 0)).toBeNull();
    await squadEventRowsForCards('p1', 0);
    expect(mocks.listSquadEvents).toHaveBeenCalledTimes(2);
  });

  it('clearing the cache forces a fresh read for the same parent and nonce', async () => {
    await squadEventRowsForCards('p1', 0);
    clearSquadEventCardRowsCache();
    await squadEventRowsForCards('p1', 0);
    expect(mocks.listSquadEvents).toHaveBeenCalledTimes(2);
  });
});
