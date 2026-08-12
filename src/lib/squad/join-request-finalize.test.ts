import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import { recordJoinRequestSent } from '../commons/commons-join-request';
import { formatJoinResponseDm } from './squad-join-mls';

vi.mock('../api/nostr', () => ({
  acceptMlsWelcome: vi.fn(),
  listPendingMlsWelcomes: vi.fn().mockResolvedValue([]),
  syncMlsGroupsNow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../invites/accept-invite', () => ({
  finalizeSquadAfterAnnouncementsWelcome: vi.fn(),
  listPendingWelcomeForGroup: vi.fn().mockResolvedValue(null),
  sameMlsGroupId: (left: string, right: string) =>
    left.trim().toLowerCase() === right.trim().toLowerCase(),
  squadInviteResolvedByMembership: vi.fn().mockReturnValue(false),
}));

vi.mock('../../stores/toast', () => ({
  showToast: vi.fn(),
}));

import {
  handleBotJoinResponseDm,
  loadPendingApprovedJoins,
  pendingApprovedJoins,
  resetPendingApprovedJoins,
} from './join-request-finalize';

describe('join request finalization', () => {
  const storage = new Map<string, string>();
  const response = formatJoinResponseDm({
    squadId: 'squad-1',
    squadName: 'Pirates',
    requestId: 'request-1',
    status: 'accepted',
  });

  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() {
        return storage.size;
      },
    } as Storage;
    setCurrentNpubForPersistence('npub1requester');
    resetPendingApprovedJoins();
    recordJoinRequestSent({
      requestId: 'request-1',
      squadId: 'squad-1',
      squadName: 'Pirates',
      botNpub: 'npub1joininbox',
      broadcastEventId: 'broadcast-1',
      sentAt: 1,
    });
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    setCurrentNpubForPersistence(null);
  });

  it('accepts only a correlated response signed by the Join inbox', async () => {
    await handleBotJoinResponseDm(response, 'npub1other');
    expect(get(pendingApprovedJoins)).toEqual([]);

    await handleBotJoinResponseDm(response, 'npub1joininbox');
    expect(get(pendingApprovedJoins)).toEqual([
      expect.objectContaining({
        groupId: 'squad-1',
        requestId: 'request-1',
      }),
    ]);
  });

  it('rejects a response with an unknown request id', async () => {
    const forged = formatJoinResponseDm({
      squadId: 'squad-1',
      squadName: 'Pirates',
      requestId: 'forged',
      status: 'accepted',
    });
    await handleBotJoinResponseDm(forged, 'npub1joininbox');
    expect(get(pendingApprovedJoins)).toEqual([]);
  });

  it('reloads approved joins after restart', async () => {
    await handleBotJoinResponseDm(response, 'npub1joininbox');
    resetPendingApprovedJoins();
    expect(get(pendingApprovedJoins)).toEqual([]);

    loadPendingApprovedJoins();
    expect(get(pendingApprovedJoins)[0]?.requestId).toBe('request-1');
  });
});
