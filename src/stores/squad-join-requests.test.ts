import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import * as squadJoinMls from '../lib/squad/squad-join-mls';
import {
  getJoinRequestPendingCount,
  pendingJoinRequestsBySquadId,
  removePendingJoinRequest,
  resetSquadJoinRequestStores,
} from './squad-join-requests';
import type { CommonsJoinRequestDto } from '../lib/commons/types';

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
    resetSquadJoinRequestStores();
    vi.restoreAllMocks();
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

  it('ensureJoinRequestsHydrated fetches once per squad', async () => {
    vi.spyOn(squadJoinMls, 'fanOutBotJoinDmsToMls').mockResolvedValue(0);
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
    vi.spyOn(squadJoinMls, 'fanOutBotJoinDmsToMls').mockResolvedValue(0);
    vi.spyOn(squadJoinMls, 'loadPendingJoinRequestsFromMls').mockRejectedValue(new Error('MLS offline'));
    const { ensureJoinRequestsHydrated, joinRequestsErrorBySquadId } = await import(
      './squad-join-requests'
    );
    await ensureJoinRequestsHydrated('squad2');
    expect(get(joinRequestsErrorBySquadId)['squad2']).toMatch(/MLS offline/i);
    expect(getJoinRequestPendingCount('squad2')).toBe(0);
  });
});
