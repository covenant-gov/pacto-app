import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/nostr', () => ({
  inviteMemberToGroup: vi.fn(),
  getMlsGroupMembers: vi.fn(),
  sendDmMessage: vi.fn(),
  formatChannelInSquadMessage: vi.fn(() => 'payload'),
}));

vi.mock('../parent-navbar', () => ({
  getAnnouncementsChannel: vi.fn(() => ({
    name: 'announcements',
    groupId: 'g-ann',
    order: 0,
  })),
}));

vi.mock('../../stores/squads', async () => {
  const { writable } = await import('svelte/store');
  const parent = {
    id: 'g-ann',
    name: 'Alpha',
    channels: [
      { name: 'announcements', groupId: 'g-ann', order: 0 },
      { name: 'ops', groupId: 'g-ops', order: 1, access: 'open' },
      { name: 'secret', groupId: 'g-sec', order: 2, access: 'closed' },
    ],
    kind: 'squad',
    createdAt: 1,
    updatedAt: 1,
  };
  return { squads: writable([parent]) };
});

import { inviteMemberToGroup, getMlsGroupMembers, sendDmMessage } from '../api/nostr';
import { admitMemberToSquad, runAdmitMembersToSquad } from './admit-member';
import type { Squad } from '../../stores/squads';

const parent: Squad = {
  id: 'g-ann',
  name: 'Alpha',
  channels: [
    { name: 'announcements', groupId: 'g-ann', order: 0 },
    { name: 'ops', groupId: 'g-ops', order: 1, access: 'open' },
    { name: 'secret', groupId: 'g-sec', order: 2, access: 'closed' },
  ],
  kind: 'squad',
  createdAt: 1,
  updatedAt: 1,
};

describe('admitMemberToSquad', () => {
  beforeEach(() => {
    vi.mocked(inviteMemberToGroup).mockReset().mockResolvedValue(undefined);
    vi.mocked(sendDmMessage).mockReset().mockResolvedValue(true);
    vi.mocked(getMlsGroupMembers).mockReset().mockResolvedValue({
      group_id: 'g',
      members: [],
      admins: [],
    });
  });

  it('admits to announcements and invites open channels in the background', async () => {
    const result = await admitMemberToSquad({ parent, memberNpub: 'npub-bob' });
    expect(result.ok).toBe(true);
    expect(result.announcementsOk).toBe(true);
    expect(inviteMemberToGroup).toHaveBeenCalledWith('g-ann', 'npub-bob');
    await vi.waitFor(() => {
      expect(inviteMemberToGroup).toHaveBeenCalledWith('g-ops', 'npub-bob');
    });
    expect(inviteMemberToGroup).not.toHaveBeenCalledWith('g-sec', 'npub-bob');
  });

  it('skips groups the member already joined', async () => {
    vi.mocked(getMlsGroupMembers).mockImplementation(async (groupId: string) => {
      if (groupId === 'g-ann') return { group_id: groupId, members: ['npub-bob'], admins: [] };
      return { group_id: groupId, members: [], admins: [] };
    });
    const result = await admitMemberToSquad({ parent, memberNpub: 'npub-bob' });
    expect(result.announcementsOk).toBe(true);
    expect(inviteMemberToGroup).not.toHaveBeenCalledWith('g-ann', 'npub-bob');
    await vi.waitFor(() => {
      expect(inviteMemberToGroup).toHaveBeenCalledWith('g-ops', 'npub-bob');
    });
  });

  it('rejects empty member or missing announcements', async () => {
    await expect(admitMemberToSquad({ parent, memberNpub: '  ' })).resolves.toMatchObject({
      ok: false,
      error: 'Squad not ready.',
    });
  });

  it('surfaces announcements invite failures', async () => {
    vi.mocked(inviteMemberToGroup).mockRejectedValueOnce(new Error('mls deny'));
    const result = await admitMemberToSquad({ parent, memberNpub: 'npub-bob' });
    expect(result.ok).toBe(false);
    expect(result.announcementsOk).toBe(false);
    expect(result.error).toMatch(/mls deny/i);
  });

  it('returns after announcements even when open-channel invite fails later', async () => {
    vi.mocked(getMlsGroupMembers).mockImplementation(async (groupId: string) => {
      if (groupId === 'g-ops') throw new Error('members down');
      return { group_id: groupId, members: [], admins: [] };
    });
    vi.mocked(inviteMemberToGroup).mockImplementation(async (groupId: string) => {
      if (groupId === 'g-ops') throw new Error('invite fail');
    });
    const result = await admitMemberToSquad({ parent, memberNpub: 'npub-bob' });
    expect(result.ok).toBe(true);
    expect(result.announcementsOk).toBe(true);
    await vi.waitFor(() => {
      expect(inviteMemberToGroup).toHaveBeenCalledWith('g-ann', 'npub-bob');
    });
  });

  it('prevents concurrent admits for the same member until background invites finish', async () => {
    let gate = Promise.withResolvers<void>();
    vi.mocked(inviteMemberToGroup).mockImplementation(async (groupId: string) => {
      if (groupId === 'g-ops') {
        await gate.promise;
      }
    });

    const first = admitMemberToSquad({ parent, memberNpub: 'npub-bob' });
    const second = admitMemberToSquad({ parent, memberNpub: 'npub-bob' });

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Only one announcements invite should run; the second call is deduped.
    const annCalls = vi.mocked(inviteMemberToGroup).mock.calls.filter(([gid]) => gid === 'g-ann');
    expect(annCalls).toHaveLength(1);

    gate.resolve();
    await vi.waitFor(() => {
      expect(inviteMemberToGroup).toHaveBeenCalledWith('g-ops', 'npub-bob');
    });
  });

  it('runAdmitMembersToSquad aggregates admitted npubs and errors', async () => {
    vi.mocked(inviteMemberToGroup).mockRejectedValueOnce(new Error('boom'));
    const onErrorBanner = vi.fn();
    const onComplete = vi.fn();
    runAdmitMembersToSquad({
      parent,
      npubs: ['npub-fail', 'npub-ok'],
      onErrorBanner,
      onComplete,
    });
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete).toHaveBeenCalledWith(['npub-ok']);
    expect(onErrorBanner).toHaveBeenCalled();
  });
});
