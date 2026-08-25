import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/nostr', () => ({
  getMlsGroupMembers: vi.fn(),
}));

vi.mock('../parent-navbar', () => ({
  getAnnouncementsChannel: vi.fn(),
  loadMembersForParent: vi.fn(),
}));

vi.mock('../squad/consent-first-invite', () => ({
  resolveAdmitterNpubs: vi.fn(),
  sendConsentFirstSquadInvite: vi.fn(),
}));

vi.mock('../../stores/auth', () => ({
  currentUser: { subscribe: vi.fn() },
}));

vi.mock('../../stores/squads', () => ({
  squads: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
}));

import { getAnnouncementsChannel, loadMembersForParent } from '../parent-navbar';
import {
  resolveAdmitterNpubs,
  sendConsentFirstSquadInvite,
} from '../squad/consent-first-invite';
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
    vi.mocked(sendConsentFirstSquadInvite).mockReset().mockResolvedValue({
      ok: true,
      inviteId: 'inv-1',
    });
    vi.mocked(resolveAdmitterNpubs).mockReset().mockResolvedValue(['npub-me', 'npub-member']);
    vi.mocked(getAnnouncementsChannel).mockReset().mockReturnValue({
      name: 'announcements',
      groupId: 'g-announce',
      order: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates to consent-first invite helper without MLS-adding', async () => {
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

    expect(sendConsentFirstSquadInvite).toHaveBeenCalledTimes(2);
    expect(sendConsentFirstSquadInvite).toHaveBeenCalledWith(parent, 'npub-a', {
      admitterNpubs: ['npub-me', 'npub-member'],
    });
    expect(onErrorBanner).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(['npub-a', 'npub-b']);
  });

  it('shows error banner when consent-first invite fails', async () => {
    setCurrentUser('npub-me');
    vi.mocked(sendConsentFirstSquadInvite)
      .mockResolvedValueOnce({ ok: false, error: 'dm failed' })
      .mockResolvedValue({ ok: true, inviteId: 'inv-2' });
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
