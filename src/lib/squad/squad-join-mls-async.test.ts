import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

const { invoke, sendDmMessage, getDmMessages } = vi.hoisted(() => ({
  invoke: vi.fn(),
  sendDmMessage: vi.fn(),
  getDmMessages: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock('../api/nostr', () => ({
  sendDmMessage: (...args: unknown[]) => sendDmMessage(...args),
  getDmMessages: (...args: unknown[]) => getDmMessages(...args),
}));

const currentUserStore = writable<{ npub: string } | null>({ npub: 'npub1holder' });

vi.mock('../../stores/auth', () => ({
  currentUser: {
    subscribe: (fn: (v: { npub: string } | null) => void) => currentUserStore.subscribe(fn),
  },
}));

import {
  clearJoinRequestRespondInFlight,
  fanOutJoinInboxDmsToMls,
  formatMlsJoinRequest,
  isJoinRequestRespondInFlight,
  markJoinRequestRespondInFlight,
  resetJoinRequestRespondInFlight,
  respondToMlsJoinRequest,
} from './squad-join-mls';

describe('respondToMlsJoinRequest', () => {
  beforeEach(() => {
    resetJoinRequestRespondInFlight();
    currentUserStore.set({ npub: 'npub1holder' });
    invoke.mockReset();
    sendDmMessage.mockReset().mockResolvedValue(undefined);
    getDmMessages.mockReset().mockResolvedValue([
      {
        id: 'm1',
        content: formatMlsJoinRequest({
          requestId: 'evt-1',
          squadId: 'squad-1',
          squadName: 'Pirates',
          broadcastEventId: 'b1',
          requesterNpub: 'npub1requester',
          createdAt: 100,
          forwardedByNpub: 'npub1holder',
        }),
        at: 100,
        npub: 'npub1holder',
      },
    ]);
  });

  afterEach(() => {
    resetJoinRequestRespondInFlight();
  });

  it('callerOwnsInFlight skips duplicate-check and does not clear caller mark', async () => {
    markJoinRequestRespondInFlight('evt-1');
    expect(isJoinRequestRespondInFlight('evt-1')).toBe(true);

    const result = await respondToMlsJoinRequest({
      requestId: 'evt-1',
      squadId: 'squad-1',
      status: 'accepted',
      callerOwnsInFlight: true,
    });

    expect(result).toEqual({ ok: true });
    expect(sendDmMessage).toHaveBeenCalled();
    expect(isJoinRequestRespondInFlight('evt-1')).toBe(true);

    clearJoinRequestRespondInFlight('evt-1');
    expect(isJoinRequestRespondInFlight('evt-1')).toBe(false);
  });

  it('without callerOwnsInFlight rejects when already marked', async () => {
    markJoinRequestRespondInFlight('evt-1');
    const result = await respondToMlsJoinRequest({
      requestId: 'evt-1',
      squadId: 'squad-1',
      status: 'rejected',
    });
    expect(result).toEqual({ ok: false, error: '' });
    expect(sendDmMessage).not.toHaveBeenCalled();
    expect(isJoinRequestRespondInFlight('evt-1')).toBe(true);
  });
});

describe('fanOutJoinInboxDmsToMls', () => {
  beforeEach(() => {
    currentUserStore.set({ npub: 'npub1holder' });
    invoke.mockReset();
    sendDmMessage.mockReset().mockResolvedValue(undefined);
    getDmMessages.mockReset().mockResolvedValue([]);
  });

  it('forwards a requester who would previously have been membership-skipped', async () => {
    invoke.mockResolvedValue([
      {
        requestId: 'req-new',
        squadId: 'squad-1',
        squadName: 'Pirates',
        broadcastEventId: 'b1',
        requesterNpub: 'npub1alreadyMember',
        createdAt: 200,
      },
    ]);

    const forwarded = await fanOutJoinInboxDmsToMls('squad-1');
    expect(forwarded).toBe(1);
    expect(sendDmMessage).toHaveBeenCalledWith(
      'squad-1',
      expect.stringContaining('req-new'),
      '',
      { virtualBucket: 'join_requests' }
    );
  });

  it('dedupes an already-open pending requester', async () => {
    const pendingContent = formatMlsJoinRequest({
      requestId: 'req-open',
      squadId: 'squad-1',
      squadName: 'Pirates',
      broadcastEventId: 'b0',
      requesterNpub: 'npub1requester',
      createdAt: 100,
      forwardedByNpub: 'npub1holder',
    });
    getDmMessages.mockResolvedValue([
      {
        id: 'm-open',
        content: pendingContent,
        at: 100,
        npub: 'npub1holder',
      },
    ]);
    invoke.mockResolvedValue([
      {
        requestId: 'req-retry',
        squadId: 'squad-1',
        squadName: 'Pirates',
        broadcastEventId: 'b1',
        requesterNpub: 'npub1requester',
        createdAt: 200,
      },
    ]);

    const forwarded = await fanOutJoinInboxDmsToMls('squad-1');
    expect(forwarded).toBe(0);
    expect(sendDmMessage).not.toHaveBeenCalled();
  });
});
