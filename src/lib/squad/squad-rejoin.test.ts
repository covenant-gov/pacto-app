import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/nostr', () => ({
  acceptMlsWelcome: vi.fn(),
  getMlsGroupMembers: vi.fn(),
  getMlsGroupMetadata: vi.fn(),
  listPendingMlsWelcomes: vi.fn(),
  parseChannelInSquadMessage: (content: string) => {
    const parsed = JSON.parse(content) as { type?: string; announcementsGroupId?: string };
    if (parsed.type !== 'channel_in_squad') return null;
    return parsed;
  },
  parseSquadInviteMessage: (content: string) => {
    const parsed = JSON.parse(content) as { type?: string };
    if (parsed.type !== 'squad_invite') return null;
    return parsed;
  },
  sendDmMessage: vi.fn(),
}));

vi.mock('../invites/accept-invite', () => ({
  finalizeSquadAfterAnnouncementsWelcome: vi.fn(),
  acceptStagedChannelWelcome: vi.fn(),
}));

vi.mock('./squad-catalog-recover', () => ({
  recoverMissingSquadCatalog: vi.fn(),
}));

vi.mock('../parent/restore-squad-access', () => ({
  restoreMemberToSquad: vi.fn(),
}));

vi.mock('../parent-navbar', () => ({
  getAnnouncementsChannel: (parent: { channels: { name: string; groupId: string }[] }) =>
    parent.channels.find((c) => c.name === 'announcements') ?? parent.channels[0],
}));

vi.mock('svelte-i18n', () => ({
  t: { subscribe: (run: (v: (key: string) => string) => void) => { run((key) => key); return () => {}; } },
}));

vi.mock('../../stores/toast', () => ({
  showToast: vi.fn(),
}));

vi.mock('../../stores/dm', async () => {
  const { writable } = await import('svelte/store');
  return { backendDmMessages: writable({}) };
});

vi.mock('../../stores/auth-session', async () => {
  const { writable } = await import('svelte/store');
  return { currentUser: writable({ npub: 'npub1me' }) };
});

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

vi.mock('../../stores/persistence-context', () => ({
  persistenceKey: (prefix: string) => `${prefix}_npub1me`,
}));

import { getMlsGroupMembers, sendDmMessage } from '../api/nostr';
import { restoreMemberToSquad } from '../parent/restore-squad-access';
import {
  formatSquadRejoinRequest,
  handleSquadRejoinRequest,
  parseSquadRejoinRequest,
  planSquadRejoinRequests,
  resetSquadRejoinState,
} from './squad-rejoin';

describe('planSquadRejoinRequests', () => {
  it('asks admitters for squads that are not local, and falls back to the DM peer', () => {
    const planned = planSquadRejoinRequests({
      selfNpub: 'npub1me',
      localGroupIds: ['g-already'],
      threads: [
        {
          peerNpub: 'npub1peer',
          messages: [
            {
              content: JSON.stringify({
                type: 'squad_invite',
                squadName: 'Alpha',
                groupId: 'g-ann',
                admitterNpubs: ['npub1admin', 'npub1me'],
              }),
            },
            {
              content: JSON.stringify({
                type: 'channel_in_squad',
                squadName: 'Alpha',
                announcementsGroupId: 'g-ann',
                channelGroupId: 'g-ops',
                channelName: 'ops',
              }),
            },
            {
              content: JSON.stringify({
                type: 'squad_invite',
                squadName: 'Joined',
                groupId: 'g-already',
              }),
            },
            {
              content: JSON.stringify({
                type: 'squad_invite',
                squadName: 'Beta',
                groupId: 'g-beta',
              }),
            },
          ],
        },
      ],
    });
    const alpha = planned.find((row) => row.parentId === 'g-ann');
    expect(alpha?.targets).toEqual(['npub1admin', 'npub1peer']);
    expect(alpha?.channelGroupIds).toEqual(['g-ops']);
    expect(planned.find((row) => row.parentId === 'g-beta')?.targets).toEqual(['npub1peer']);
    expect(planned.find((row) => row.parentId === 'g-already')).toBeUndefined();
  });
});

describe('parseSquadRejoinRequest', () => {
  it('round-trips a request and rejects a requester who is not an npub', () => {
    const raw = formatSquadRejoinRequest({
      parent_id: 'g-ann',
      requester_npub: 'npub1me',
      request_id: 'r1',
    });
    expect(parseSquadRejoinRequest(raw)?.request_id).toBe('r1');
    expect(
      parseSquadRejoinRequest(
        JSON.stringify({
          type: 'squad_rejoin_request',
          payload: { parent_id: 'g', requester_npub: 'bob', request_id: 'r' },
        }),
      ),
    ).toBeNull();
  });
});

describe('handleSquadRejoinRequest', () => {
  const payload = {
    parent_id: 'g-ann',
    requester_npub: 'npub1bob',
    request_id: 'r1',
  };
  const storage = new Map<string, string>();

  beforeEach(() => {
    resetSquadRejoinState();
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    });
    vi.mocked(getMlsGroupMembers).mockReset();
    vi.mocked(sendDmMessage).mockReset().mockResolvedValue(true);
    vi.mocked(restoreMemberToSquad).mockReset().mockResolvedValue({ ok: true });
  });

  it('ignores a requester who has no leaf', async () => {
    vi.mocked(getMlsGroupMembers).mockResolvedValue({
      group_id: 'g-ann',
      members: ['npub1me'],
      admins: ['npub1me'],
      pending_welcomes: [],
    });
    await handleSquadRejoinRequest(payload, { fanOut: true });
    expect(restoreMemberToSquad).not.toHaveBeenCalled();
    expect(sendDmMessage).not.toHaveBeenCalled();
  });

  it('restores the squad when this device is an MLS admin', async () => {
    vi.mocked(getMlsGroupMembers).mockResolvedValue({
      group_id: 'g-ann',
      members: ['npub1me', 'npub1bob'],
      admins: ['npub1me'],
      pending_welcomes: [],
    });
    await handleSquadRejoinRequest(payload, { fanOut: true });
    expect(restoreMemberToSquad).toHaveBeenCalledWith({
      parent: expect.objectContaining({ id: 'g-ann' }),
      memberNpub: 'npub1bob',
    });
  });

  it('fans the ask out once when this device is a member but not an admin', async () => {
    vi.mocked(getMlsGroupMembers).mockResolvedValue({
      group_id: 'g-ann',
      members: ['npub1me', 'npub1bob'],
      admins: ['npub1admin'],
      pending_welcomes: [],
    });
    await handleSquadRejoinRequest(payload, { fanOut: true });
    await handleSquadRejoinRequest(payload, { fanOut: true });
    expect(restoreMemberToSquad).not.toHaveBeenCalled();
    expect(sendDmMessage).toHaveBeenCalledTimes(1);
    expect(sendDmMessage).toHaveBeenCalledWith(
      'g-ann',
      expect.stringContaining('squad_rejoin_needed'),
      '',
      { virtualBucket: 'announcements' },
    );
  });
});
