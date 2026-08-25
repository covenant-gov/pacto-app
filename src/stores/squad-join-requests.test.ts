import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import * as squadJoinMls from '../lib/squad/squad-join-mls';
import type { CommonsJoinRequestDto } from '../lib/commons/types';

const mockResolveCatchUpEntry = vi.hoisted(() => vi.fn());
const mockGetCatchUpCount = vi.hoisted(() => vi.fn());
const mockRecordActionNeededEntry = vi.hoisted(() => vi.fn());

vi.mock('../lib/api/catch-up', () => ({
  resolveCatchUpEntry: (...args: unknown[]) => mockResolveCatchUpEntry(...args),
  getCatchUpCount: (...args: unknown[]) => mockGetCatchUpCount(...args),
  recordActionNeededEntry: (...args: unknown[]) => mockRecordActionNeededEntry(...args),
  listCatchUpEntries: vi.fn(),
  resolveAllCatchUpEntries: vi.fn(),
}));

import {
  getJoinRequestPendingCount,
  pendingJoinRequestsBySquadId,
  removePendingJoinRequest,
  resetSquadJoinRequestStores,
} from './squad-join-requests';
import { catchUpCount, resetCatchUpStore } from './catch-up';

function sampleRequest(eventId: string): CommonsJoinRequestDto {
  return {
    eventId,
    requesterNpub: 'npub1',
    squadId: 'squad1',
    squadName: 'Z',
    broadcastEventId: 'b1',
    createdAt: 1,
    status: 'pending',
  };
}

describe('squad join requests store', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetSquadJoinRequestStores();
    resetCatchUpStore();
    mockResolveCatchUpEntry.mockReset().mockResolvedValue(true);
    mockGetCatchUpCount.mockReset().mockResolvedValue(0);
    mockRecordActionNeededEntry.mockReset().mockResolvedValue(undefined);
  });

  it('getJoinRequestPendingCount reflects pending list length', () => {
    pendingJoinRequestsBySquadId.set({ squad1: [sampleRequest('a'), sampleRequest('b')] });
    expect(getJoinRequestPendingCount('squad1')).toBe(2);
  });

  it('removePendingJoinRequest decrements only on accept/reject', () => {
    pendingJoinRequestsBySquadId.set({ squad1: [sampleRequest('a'), sampleRequest('b')] });
    removePendingJoinRequest('squad1', 'a');
    expect(getJoinRequestPendingCount('squad1')).toBe(1);
    expect(get(pendingJoinRequestsBySquadId).squad1.map((r) => r.eventId)).toEqual(['b']);
  });

  it('removePendingJoinRequest refreshes catchUpCount after resolve', async () => {
    pendingJoinRequestsBySquadId.set({ squad1: [sampleRequest('a'), sampleRequest('b')] });
    catchUpCount.set(2);
    mockGetCatchUpCount.mockResolvedValueOnce(1);
    removePendingJoinRequest('squad1', 'a');
    await vi.waitFor(() => {
      expect(mockResolveCatchUpEntry).toHaveBeenCalledWith('join-request:a');
      expect(get(catchUpCount)).toBe(1);
    });
  });

  it('ensureJoinRequestsHydrated fetches once per squad', async () => {
    vi.spyOn(squadJoinMls, 'fanOutJoinInboxDmsToMls').mockResolvedValue(0);
    const fetchSpy = vi
      .spyOn(squadJoinMls, 'loadPendingJoinRequestsFromMls')
      .mockResolvedValue([sampleRequest('x')]);
    const { ensureJoinRequestsHydrated } = await import('./squad-join-requests');
    await ensureJoinRequestsHydrated('squad1');
    await ensureJoinRequestsHydrated('squad1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(getJoinRequestPendingCount('squad1')).toBe(1);
  });

  it('ensureJoinRequestsHydrated surfaces MLS load errors', async () => {
    vi.spyOn(squadJoinMls, 'fanOutJoinInboxDmsToMls').mockResolvedValue(0);
    vi.spyOn(squadJoinMls, 'loadPendingJoinRequestsFromMls').mockRejectedValue(new Error('MLS offline'));
    const { ensureJoinRequestsHydrated, joinRequestsErrorBySquadId } = await import(
      './squad-join-requests'
    );
    await ensureJoinRequestsHydrated('squad2');
    expect(get(joinRequestsErrorBySquadId)['squad2']).toMatch(/MLS offline/i);
    expect(getJoinRequestPendingCount('squad2')).toBe(0);
  });

  it('still loads MLS pending when fan-out fails', async () => {
    vi.spyOn(squadJoinMls, 'fanOutJoinInboxDmsToMls').mockRejectedValue(new Error('Could not sync join inbox.'));
    const fetchSpy = vi
      .spyOn(squadJoinMls, 'loadPendingJoinRequestsFromMls')
      .mockResolvedValue([sampleRequest('kept')]);
    resetSquadJoinRequestStores();
    const { ensureJoinRequestsHydrated, joinRequestsErrorBySquadId } = await import(
      './squad-join-requests'
    );
    await ensureJoinRequestsHydrated('squad3');
    expect(fetchSpy).toHaveBeenCalled();
    expect(getJoinRequestPendingCount('squad3')).toBe(1);
    expect(get(joinRequestsErrorBySquadId)['squad3']).toBeUndefined();
  });
});
