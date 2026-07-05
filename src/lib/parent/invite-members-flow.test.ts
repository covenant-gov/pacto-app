import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/nostr', () => ({
  inviteMemberToGroup: vi.fn(),
}));

vi.mock('../parent-navbar', () => ({
  defaultParentInvitePhysicalGroupTargets: vi.fn(),
  getAnnouncementsChannel: vi.fn(),
  loadMembersForParent: vi.fn(),
}));

vi.mock('../pacto-app-inbox', () => ({
  sendSquadInviteDm: vi.fn(),
}));

vi.mock('../../stores/auth', () => ({
  currentUser: { subscribe: vi.fn() },
}));

vi.mock('../../stores/squads', () => ({
  squads: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
}));

import { inviteMemberToGroup } from '../api/nostr';
import {
  defaultParentInvitePhysicalGroupTargets,
  getAnnouncementsChannel,
  loadMembersForParent,
} from '../parent-navbar';
import { sendSquadInviteDm } from '../pacto-app-inbox';
import { currentUser } from '../../stores/auth';
import {
  loadInviteCandidateNpubs,
  runInviteMembersToParent,
} from './invite-members-flow';
import type { Squad } from '../../stores/squads';

const parent: Squad = {
  id: 'parent-1',
  name: 'Alpha',
  channels: [
    { name: 'announcements', groupId: 'g-announce', order: 0 },
    { name: 'inbox', groupId: 'g-inbox', order: 1 },
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
    vi.mocked(inviteMemberToGroup).mockReset().mockResolvedValue(undefined);
    vi.mocked(sendSquadInviteDm).mockReset().mockResolvedValue(true);
    vi.mocked(defaultParentInvitePhysicalGroupTargets).mockReset().mockReturnValue([
      { name: 'announcements', groupId: 'g-announce', order: 0 },
      { name: 'inbox', groupId: 'g-inbox', order: 1 },
    ]);
    vi.mocked(getAnnouncementsChannel).mockReset().mockReturnValue({
      name: 'announcements',
      groupId: 'g-announce',
      order: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invites to each physical group and sends DMs', async () => {
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

    expect(inviteMemberToGroup).toHaveBeenCalledTimes(4);
    expect(inviteMemberToGroup).toHaveBeenCalledWith('g-announce', 'npub-a');
    expect(inviteMemberToGroup).toHaveBeenCalledWith('g-inbox', 'npub-a');
    expect(inviteMemberToGroup).toHaveBeenCalledWith('g-announce', 'npub-b');
    expect(inviteMemberToGroup).toHaveBeenCalledWith('g-inbox', 'npub-b');

    expect(sendSquadInviteDm).toHaveBeenCalledTimes(2);
    expect(sendSquadInviteDm).toHaveBeenCalledWith(
      'npub-a',
      { squadName: 'Alpha', groupId: 'g-announce' },
      'npub-me'
    );
    expect(sendSquadInviteDm).toHaveBeenCalledWith(
      'npub-b',
      { squadName: 'Alpha', groupId: 'g-announce' },
      'npub-me'
    );

    expect(onErrorBanner).not.toHaveBeenCalled();
  });

  it('shows error banner and still completes on MLS invite failure', async () => {
    setCurrentUser('npub-me');
    vi.mocked(inviteMemberToGroup)
      .mockRejectedValueOnce(new Error('invite failed'))
      .mockResolvedValue(undefined);
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

    expect(onErrorBanner).toHaveBeenCalledWith('invite failed');
  });

  it('shows error banner when squad invite DM fails', async () => {
    setCurrentUser('npub-me');
    vi.mocked(inviteMemberToGroup).mockResolvedValue(undefined);
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

    expect(sendSquadInviteDm).toHaveBeenCalledWith(
      'npub-a',
      { squadName: 'Alpha', groupId: 'g-announce' },
      'npub-me'
    );
    expect(onErrorBanner).toHaveBeenCalledWith('dm failed');
  });
});
