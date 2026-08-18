import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/nostr', () => ({
  getMlsGroupMembers: vi.fn(),
}));

vi.mock('../parent-navbar', () => ({
  getAnnouncementsChannel: vi.fn(),
  loadMembersForParent: vi.fn(),
}));

vi.mock('../pacto-app-inbox', () => ({
  sendSquadInviteDm: vi.fn(),
}));

vi.mock('../squad/squad-outbound-invite', () => ({
  publishOutboundInviteAnnounce: vi.fn(),
}));

vi.mock('../../stores/auth', () => ({
  currentUser: { subscribe: vi.fn() },
}));

vi.mock('../../stores/squads', () => ({
  squads: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
}));

import { getMlsGroupMembers } from '../api/nostr';
import { getAnnouncementsChannel, loadMembersForParent } from '../parent-navbar';
import { sendSquadInviteDm } from '../pacto-app-inbox';
import { publishOutboundInviteAnnounce } from '../squad/squad-outbound-invite';
import { currentUser } from '../../stores/auth';
import {
  loadInviteCandidateNpubs,
  runInviteMembersToParent,
} from './invite-members-flow';
import type { Squad } from '../../stores/squads';

const parent: Squad = {
  id: 'parent-1',
  name: 'Alpha',
  iconUrl: 'https://cdn.example/a.jpg',
  channels: [
    { name: 'announcements', groupId: 'g-announce', order: 0 },
    { name: 'polls', groupId: 'g-announce', order: 1 },
    { name: 'ops', groupId: 'g-ops', order: 2, access: 'open' },
  ],
  kind: 'squad',
  createdAt: 1,
  updatedAt: 1,
};

function setCurrentUser(npub: string | null) {
  currentUser.subscribe = vi.fn((fn: (u: { npub: string } | null) => void) => {
    fn(npub ? { npub } : null);
    return () => {};
  });
}

describe('loadInviteCandidateNpubs', () => {
  it('filters out existing members and current user', async () => {
    vi.mocked(loadMembersForParent).mockResolvedValue(['npub-member', 'npub-me']);
    const candidates = await loadInviteCandidateNpubs(
      parent,
      ['npub-member', 'npub-me', 'npub-new'],
      'npub-me'
    );
    expect(candidates).toEqual(['npub-new']);
  });

  it('deduplicates input npubs', async () => {
    vi.mocked(loadMembersForParent).mockResolvedValue([]);
    const candidates = await loadInviteCandidateNpubs(
      parent,
      ['npub-a', 'npub-a', 'npub-b'],
      'npub-me'
    );
    expect(candidates).toEqual(['npub-a', 'npub-b']);
  });
});

describe('runInviteMembersToParent', () => {
  beforeEach(() => {
    vi.mocked(sendSquadInviteDm).mockReset().mockResolvedValue(true);
    vi.mocked(publishOutboundInviteAnnounce).mockReset().mockResolvedValue(true);
    vi.mocked(getMlsGroupMembers).mockReset().mockResolvedValue({
      members: ['npub-me', 'npub-member'],
      admins: [],
      group_id: 'g-announce',
    });
    vi.mocked(getAnnouncementsChannel).mockReset().mockReturnValue({
      name: 'announcements',
      groupId: 'g-announce',
      order: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends inbox invite + outbound announce without MLS-adding', async () => {
    setCurrentUser('npub-me');
    const onComplete = vi.fn();
    const onErrorBanner = vi.fn();

    runInviteMembersToParent({
      parent,
      npubsToInvite: ['npub-a', 'npub-b'],
      onErrorBanner,
      onComplete,
    });

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });

    expect(publishOutboundInviteAnnounce).toHaveBeenCalledTimes(2);
    expect(sendSquadInviteDm).toHaveBeenCalledTimes(2);
    expect(sendSquadInviteDm).toHaveBeenCalledWith(
      'npub-a',
      expect.objectContaining({
        squadName: 'Alpha',
        groupId: 'g-announce',
        inviteId: expect.any(String),
        admitterNpubs: expect.arrayContaining(['npub-me', 'npub-member']),
        iconUrl: 'https://cdn.example/a.jpg',
      }),
      'npub-me'
    );
    expect(onErrorBanner).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(['npub-a', 'npub-b']);
  });

  it('shows error banner when squad invite DM fails', async () => {
    setCurrentUser('npub-me');
    vi.mocked(sendSquadInviteDm)
      .mockRejectedValueOnce(new Error('dm failed'))
      .mockResolvedValue(true);
    const onComplete = vi.fn();
    const onErrorBanner = vi.fn();

    runInviteMembersToParent({
      parent,
      npubsToInvite: ['npub-a'],
      onErrorBanner,
      onComplete,
    });

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });

    expect(onErrorBanner).toHaveBeenCalledWith('dm failed');
  });
});
