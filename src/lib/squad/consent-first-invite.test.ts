import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-i18n', () => ({
  t: {
    subscribe: (fn: (translate: (key: string) => string) => void) => {
      fn((key: string) => key);
      return () => {};
    },
  },
}));

vi.mock('../api/nostr', () => ({
  getMlsGroupMembers: vi.fn(),
}));

vi.mock('../parent-navbar', () => ({
  getAnnouncementsChannel: vi.fn(),
}));

vi.mock('../pacto-app-inbox', () => ({
  sendSquadInviteDm: vi.fn(),
}));

vi.mock('./squad-outbound-invite', () => ({
  publishOutboundInviteAnnounce: vi.fn(),
}));

vi.mock('../../stores/auth', () => ({
  currentUser: { subscribe: vi.fn() },
}));

import { getMlsGroupMembers } from '../api/nostr';
import { getAnnouncementsChannel } from '../parent-navbar';
import { sendSquadInviteDm } from '../pacto-app-inbox';
import { publishOutboundInviteAnnounce } from './squad-outbound-invite';
import { currentUser } from '../../stores/auth';
import {
  resolveAdmitterNpubs,
  sendConsentFirstSquadInvite,
} from './consent-first-invite';
import type { Squad } from '../../stores/squads';

const parent: Squad = {
  id: 'g-announce',
  name: 'Alpha',
  iconUrl: 'https://cdn.example/a.jpg',
  channels: [{ name: 'announcements', groupId: 'g-announce', order: 0 }],
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

describe('sendConsentFirstSquadInvite', () => {
  beforeEach(() => {
    vi.mocked(sendSquadInviteDm).mockReset().mockResolvedValue(true);
    vi.mocked(publishOutboundInviteAnnounce).mockReset().mockResolvedValue(true);
    vi.mocked(getMlsGroupMembers).mockReset().mockResolvedValue({
      members: ['npub1me', 'npub1member'],
      admins: [],
      group_id: 'g-announce',
      pending_welcomes: [],
    });
    vi.mocked(getAnnouncementsChannel).mockReset().mockReturnValue({
      name: 'announcements',
      groupId: 'g-announce',
      order: 0,
    });
    setCurrentUser('npub1me');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes outbound announce and sends DM with inviteId + admitters', async () => {
    const result = await sendConsentFirstSquadInvite(parent, 'npub1invitee');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.inviteId).toEqual(expect.any(String));
    expect(publishOutboundInviteAnnounce).toHaveBeenCalledWith(
      parent,
      expect.any(String),
      'npub1invitee'
    );
    expect(sendSquadInviteDm).toHaveBeenCalledWith(
      'npub1invitee',
      expect.objectContaining({
        squadName: 'Alpha',
        groupId: 'g-announce',
        inviteId: expect.any(String),
        admitterNpubs: expect.arrayContaining(['npub1me', 'npub1member']),
        iconUrl: 'https://cdn.example/a.jpg',
      }),
      'npub1me'
    );
  });

  it('reuses precomputed admitterNpubs', async () => {
    await sendConsentFirstSquadInvite(parent, 'npub1invitee', {
      admitterNpubs: ['npub1only'],
    });
    expect(getMlsGroupMembers).not.toHaveBeenCalled();
    expect(sendSquadInviteDm).toHaveBeenCalledWith(
      'npub1invitee',
      expect.objectContaining({ admitterNpubs: ['npub1only'] }),
      'npub1me'
    );
  });

  it('fails when announcements groupId is missing', async () => {
    vi.mocked(getAnnouncementsChannel).mockReturnValue({
      name: 'announcements',
      groupId: '',
      order: 0,
    });
    const result = await sendConsentFirstSquadInvite(parent, 'npub1invitee');
    expect(result).toEqual({
      ok: false,
      error: 'squad.consentFirstInvite.channelsNotReady',
    });
    expect(sendSquadInviteDm).not.toHaveBeenCalled();
  });

  it('fails on invalid invitee npub', async () => {
    const result = await sendConsentFirstSquadInvite(parent, 'bad-npub');
    expect(result).toEqual({
      ok: false,
      error: 'squad.consentFirstInvite.invalidInvitee',
    });
    expect(publishOutboundInviteAnnounce).not.toHaveBeenCalled();
    expect(sendSquadInviteDm).not.toHaveBeenCalled();
  });

  it('fails when no admitters available', async () => {
    setCurrentUser(null);
    vi.mocked(getMlsGroupMembers).mockResolvedValue({
      members: [],
      admins: [],
      group_id: 'g-announce',
      pending_welcomes: [],
    });
    const result = await sendConsentFirstSquadInvite(parent, 'npub1invitee');
    expect(result).toEqual({
      ok: false,
      error: 'squad.consentFirstInvite.noAdmitters',
    });
    expect(publishOutboundInviteAnnounce).not.toHaveBeenCalled();
    expect(sendSquadInviteDm).not.toHaveBeenCalled();
  });

  it('fails when outbound announce returns false and skips DM', async () => {
    vi.mocked(publishOutboundInviteAnnounce).mockResolvedValue(false);
    const result = await sendConsentFirstSquadInvite(parent, 'npub1invitee');
    expect(result).toEqual({
      ok: false,
      error: 'squad.consentFirstInvite.announceFailed',
    });
    expect(sendSquadInviteDm).not.toHaveBeenCalled();
  });

  it('fails when outbound announce throws and skips DM', async () => {
    vi.mocked(publishOutboundInviteAnnounce).mockRejectedValue(new Error('relay down'));
    const result = await sendConsentFirstSquadInvite(parent, 'npub1invitee');
    expect(result).toEqual({
      ok: false,
      error: 'squad.consentFirstInvite.announceFailed',
    });
    expect(sendSquadInviteDm).not.toHaveBeenCalled();
  });
});

describe('resolveAdmitterNpubs', () => {
  it('falls back to self when MLS members fetch fails', async () => {
    vi.mocked(getMlsGroupMembers).mockRejectedValueOnce(new Error('offline'));
    await expect(resolveAdmitterNpubs('g1', 'npub1me')).resolves.toEqual(['npub1me']);
  });
});
