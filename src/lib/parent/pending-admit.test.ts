import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal(
  'localStorage',
  (() => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
      clear: () => map.clear(),
    };
  })()
);

vi.mock('./admit-member', () => ({
  admitMemberToSquad: vi.fn(),
}));

vi.mock('../../stores/squads', async () => {
  const { writable } = await import('svelte/store');
  return {
    squads: writable([
      {
        id: 'g-ann',
        name: 'Alpha',
        channels: [{ name: 'announcements', groupId: 'g-ann', order: 0 }],
        kind: 'squad',
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  };
});

import { admitMemberToSquad } from './admit-member';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  clearPendingAdmitForMember,
  drainPendingAdmitQueue,
  enqueuePendingAdmit,
  listPendingAdmitForParent,
  loadPendingAdmitQueue,
  pendingAdmitQueue,
  resetPendingAdmitState,
} from './pending-admit';
import { get } from 'svelte/store';

describe('pending-admit', () => {
  beforeEach(() => {
    resetPendingAdmitState();
    setCurrentNpubForPersistence('npub1test');
    localStorage.clear();
    loadPendingAdmitQueue();
    vi.mocked(admitMemberToSquad).mockReset().mockResolvedValue({
      ok: true,
      announcementsOk: true,
      openChannelsInvited: 0,
    });
  });

  it('persists and loads queue entries', () => {
    enqueuePendingAdmit({
      kind: 'invite',
      parentId: 'g-ann',
      memberNpub: 'npub-bob',
      inviteId: 'inv-1',
    });
    expect(listPendingAdmitForParent('g-ann')).toHaveLength(1);
    resetPendingAdmitState();
    setCurrentNpubForPersistence('npub1test');
    loadPendingAdmitQueue();
    expect(get(pendingAdmitQueue)).toHaveLength(1);
  });

  it('drain removes entry on successful admit', async () => {
    enqueuePendingAdmit({
      kind: 'join',
      parentId: 'g-ann',
      memberNpub: 'npub-bob',
      requestId: 'req-1',
    });
    await drainPendingAdmitQueue();
    expect(admitMemberToSquad).toHaveBeenCalled();
    expect(listPendingAdmitForParent('g-ann')).toHaveLength(0);
  });

  it('drain keeps entry on failed admit', async () => {
    vi.mocked(admitMemberToSquad).mockResolvedValue({
      ok: false,
      announcementsOk: false,
      openChannelsInvited: 0,
      error: 'no keypackages',
    });
    enqueuePendingAdmit({
      kind: 'invite',
      parentId: 'g-ann',
      memberNpub: 'npub-bob',
      inviteId: 'inv-1',
    });
    await drainPendingAdmitQueue();
    const rows = listPendingAdmitForParent('g-ann');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastError).toContain('keypackages');
  });

  it('clearPendingAdmitForMember removes matching rows', () => {
    enqueuePendingAdmit({
      kind: 'invite',
      parentId: 'g-ann',
      memberNpub: 'npub-bob',
      inviteId: 'inv-1',
    });
    clearPendingAdmitForMember('g-ann', 'npub-bob');
    expect(listPendingAdmitForParent('g-ann')).toHaveLength(0);
  });
});
