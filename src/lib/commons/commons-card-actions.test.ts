import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { sendCommonsJoinRequest } from './commons-card-actions';
import type { CommonsBroadcastDto } from './types';
import {
  getJoinRequestRecord,
  isJoinRequestInFlight,
  resetCommonsJoinRequestRevision,
} from './commons-join-request';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';

vi.mock('../api/nostr', () => ({
  sendDmMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../stores/profiles', () => ({
  loadProfile: vi.fn(),
}));

import { sendDmMessage } from '../api/nostr';

const broadcast: CommonsBroadcastDto = {
  eventId: 'evt1',
  authorNpub: 'npub1botxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  subject: 'squad',
  subjectId: 'squad-mls-id',
  message: 'hello',
  durationHours: 72,
  expiresAt: 9999999999,
  tags: ['a', 'b', 'c'],
  createdAt: 1,
  squadId: 'squad-mls-id',
  squadName: 'Pirates',
};

describe('sendCommonsJoinRequest', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    resetCommonsJoinRequestRevision();
    store.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
    setCurrentNpubForPersistence('npub1me');
    vi.mocked(sendDmMessage).mockReset();
    vi.mocked(sendDmMessage).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('sends structured join inbox DM to broadcast author', async () => {
    const result = await sendCommonsJoinRequest(broadcast, 'npub1me', []);
    expect(result).toEqual({ ok: true });
    expect(sendDmMessage).toHaveBeenCalledWith(
      broadcast.authorNpub,
      expect.stringContaining('pacto.squad.join_inbox_dm.v1')
    );
    expect(isJoinRequestInFlight('squad-mls-id')).toBe(false);
  });

  it('marks in-flight during send and clears afterward', async () => {
    let resolveSend!: () => void;
    vi.mocked(sendDmMessage).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveSend = resolve;
      }) as never,
    );

    const pending = sendCommonsJoinRequest(broadcast, 'npub1me', []);
    await vi.waitFor(() => {
      expect(isJoinRequestInFlight('squad-mls-id')).toBe(true);
    });

    resolveSend();
    await expect(pending).resolves.toEqual({ ok: true });
    expect(isJoinRequestInFlight('squad-mls-id')).toBe(false);
  });

  it('no-ops a concurrent second send for the same squad', async () => {
    let resolveSend!: () => void;
    vi.mocked(sendDmMessage).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveSend = resolve;
      }) as never,
    );

    const first = sendCommonsJoinRequest(broadcast, 'npub1me', []);
    await vi.waitFor(() => {
      expect(isJoinRequestInFlight('squad-mls-id')).toBe(true);
    });

    const second = await sendCommonsJoinRequest(broadcast, 'npub1me', []);
    expect(second).toEqual({ ok: true });
    expect(sendDmMessage).toHaveBeenCalledTimes(1);

    resolveSend();
    await expect(first).resolves.toEqual({ ok: true });
  });

  it('clears in-flight when send fails', async () => {
    vi.mocked(sendDmMessage).mockRejectedValueOnce(new Error('relay down'));
    const result = await sendCommonsJoinRequest(broadcast, 'npub1me', []);
    expect(result.ok).toBe(false);
    expect(isJoinRequestInFlight('squad-mls-id')).toBe(false);
    expect(getJoinRequestRecord('squad-mls-id')).toBeNull();
  });
});
