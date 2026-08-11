import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/nostr', () => ({
  sendDmMessage: vi.fn(),
  getDmMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock('../parent-navbar', () => ({
  getAnnouncementsChannel: vi.fn(() => ({
    name: 'announcements',
    groupId: 'g-ann',
    order: 0,
  })),
}));

vi.mock('../parent/admit-member', () => ({
  admitMemberToSquad: vi.fn(),
}));

vi.mock('../parent/pending-admit', () => ({
  enqueuePendingAdmit: vi.fn(),
  clearPendingAdmitForMember: vi.fn(),
}));

vi.mock('../../stores/auth', async () => {
  const { writable } = await import('svelte/store');
  return { currentUser: writable({ npub: 'npub-me' }) };
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

import { getDmMessages, sendDmMessage } from '../api/nostr';
import { getAnnouncementsChannel } from '../parent-navbar';
import { admitMemberToSquad } from '../parent/admit-member';
import { enqueuePendingAdmit } from '../parent/pending-admit';
import { currentUser } from '../../stores/auth';
import { squads } from '../../stores/squads';
import {
  formatSquadAdmitNeeded,
  formatSquadInviteAccepted,
  formatSquadOutboundInvite,
  handleInviteeConsentForAdmit,
  onMlsAdmitNeeded,
  onMlsOutboundInviteAnnounce,
  parseSquadAdmitNeeded,
  parseSquadInviteAccepted,
  parseSquadOutboundInvite,
  publishInviteAcceptedClaims,
  publishOutboundInviteAnnounce,
  rememberOutboundInvite,
  resetOutboundInviteStateForTests,
  SQUAD_ADMIT_NEEDED_TYPE,
  SQUAD_INVITE_ACCEPTED_TYPE,
  SQUAD_OUTBOUND_INVITE_TYPE,
} from './squad-outbound-invite';

const validOutbound = {
  parent_id: 'g-ann',
  invite_id: 'inv-1',
  invitee_npub: 'npub-bob',
  squad_name: 'Alpha',
};

describe('squad-outbound-invite parsers', () => {
  it('round-trips outbound invite format/parse', () => {
    const raw = formatSquadOutboundInvite(validOutbound);
    expect(JSON.parse(raw).type).toBe(SQUAD_OUTBOUND_INVITE_TYPE);
    expect(parseSquadOutboundInvite(raw)).toEqual(validOutbound);
  });

  it('rejects invalid outbound invite payloads', () => {
    expect(parseSquadOutboundInvite(null)).toBeNull();
    expect(parseSquadOutboundInvite('')).toBeNull();
    expect(parseSquadOutboundInvite('not-json')).toBeNull();
    expect(parseSquadOutboundInvite('{')).toBeNull();
    expect(parseSquadOutboundInvite(JSON.stringify({ type: 'other' }))).toBeNull();
    expect(
      parseSquadOutboundInvite(JSON.stringify({ type: SQUAD_OUTBOUND_INVITE_TYPE, payload: null })),
    ).toBeNull();
    expect(
      parseSquadOutboundInvite(
        JSON.stringify({
          type: SQUAD_OUTBOUND_INVITE_TYPE,
          payload: { parent_id: 1, invite_id: 'i', invitee_npub: 'n', squad_name: 's' },
        }),
      ),
    ).toBeNull();
    expect(
      parseSquadOutboundInvite(
        JSON.stringify({
          type: SQUAD_OUTBOUND_INVITE_TYPE,
          payload: { parent_id: 'p', invite_id: '', invitee_npub: 'n', squad_name: 's' },
        }),
      ),
    ).toBeNull();
    expect(
      parseSquadOutboundInvite(
        JSON.stringify({
          type: SQUAD_OUTBOUND_INVITE_TYPE,
          payload: {
            parent_id: ' p ',
            invite_id: ' i ',
            invitee_npub: ' n ',
            squad_name: 9,
          },
        }),
      ),
    ).toEqual({
      parent_id: 'p',
      invite_id: 'i',
      invitee_npub: 'n',
      squad_name: '',
    });
  });

  it('round-trips invite accepted format/parse', () => {
    const raw = formatSquadInviteAccepted(validOutbound);
    expect(JSON.parse(raw).type).toBe(SQUAD_INVITE_ACCEPTED_TYPE);
    expect(parseSquadInviteAccepted(raw)).toEqual(validOutbound);
  });

  it('rejects invalid invite accepted payloads', () => {
    expect(parseSquadInviteAccepted(undefined)).toBeNull();
    expect(parseSquadInviteAccepted('plain')).toBeNull();
    expect(parseSquadInviteAccepted('{bad')).toBeNull();
    expect(parseSquadInviteAccepted(JSON.stringify({ type: 'other' }))).toBeNull();
    expect(
      parseSquadInviteAccepted(JSON.stringify({ type: SQUAD_INVITE_ACCEPTED_TYPE })),
    ).toBeNull();
    expect(
      parseSquadInviteAccepted(
        JSON.stringify({
          type: SQUAD_INVITE_ACCEPTED_TYPE,
          payload: { parent_id: 'p', invite_id: true, invitee_npub: 'n', squad_name: 's' },
        }),
      ),
    ).toBeNull();
    expect(
      parseSquadInviteAccepted(
        JSON.stringify({
          type: SQUAD_INVITE_ACCEPTED_TYPE,
          payload: { parent_id: '', invite_id: 'i', invitee_npub: 'n', squad_name: 's' },
        }),
      ),
    ).toBeNull();
    expect(
      parseSquadInviteAccepted(
        JSON.stringify({
          type: SQUAD_INVITE_ACCEPTED_TYPE,
          payload: {
            parent_id: 'p',
            invite_id: 'i',
            invitee_npub: 'n',
            squad_name: '  Name  ',
          },
        }),
      ),
    ).toEqual({
      parent_id: 'p',
      invite_id: 'i',
      invitee_npub: 'n',
      squad_name: 'Name',
    });
  });

  it('round-trips admit needed format/parse', () => {
    const payload = {
      parent_id: 'g-ann',
      invite_id: 'inv-1',
      invitee_npub: 'npub-bob',
    };
    const raw = formatSquadAdmitNeeded(payload);
    expect(JSON.parse(raw).type).toBe(SQUAD_ADMIT_NEEDED_TYPE);
    expect(parseSquadAdmitNeeded(raw)).toEqual(payload);
  });

  it('rejects invalid admit needed payloads', () => {
    expect(parseSquadAdmitNeeded(null)).toBeNull();
    expect(parseSquadAdmitNeeded('x')).toBeNull();
    expect(parseSquadAdmitNeeded('{')).toBeNull();
    expect(parseSquadAdmitNeeded(JSON.stringify({ type: 'other' }))).toBeNull();
    expect(parseSquadAdmitNeeded(JSON.stringify({ type: SQUAD_ADMIT_NEEDED_TYPE }))).toBeNull();
    expect(
      parseSquadAdmitNeeded(
        JSON.stringify({
          type: SQUAD_ADMIT_NEEDED_TYPE,
          payload: { parent_id: 'p', invite_id: 'i', invitee_npub: 3 },
        }),
      ),
    ).toBeNull();
    expect(
      parseSquadAdmitNeeded(
        JSON.stringify({
          type: SQUAD_ADMIT_NEEDED_TYPE,
          payload: { parent_id: 'p', invite_id: 'i', invitee_npub: '  ' },
        }),
      ),
    ).toBeNull();
  });
});

describe('squad-outbound-invite flows', () => {
  beforeEach(() => {
    resetOutboundInviteStateForTests();
    vi.mocked(sendDmMessage).mockReset().mockResolvedValue(true);
    vi.mocked(getDmMessages).mockReset().mockResolvedValue([]);
    vi.mocked(admitMemberToSquad).mockReset().mockResolvedValue({
      ok: true,
      announcementsOk: true,
      openChannelsInvited: 0,
    });
    vi.mocked(enqueuePendingAdmit).mockReset();
    vi.mocked(getAnnouncementsChannel).mockReturnValue({
      name: 'announcements',
      groupId: 'g-ann',
      order: 0,
    } as ReturnType<typeof getAnnouncementsChannel>);
    currentUser.set({ npub: 'npub-me' } as never);
    squads.set([
      {
        id: 'g-ann',
        name: 'Alpha',
        channels: [{ name: 'announcements', groupId: 'g-ann', order: 0 }],
        kind: 'squad',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it('publishOutboundInviteAnnounce sends MLS announce and remembers invite', async () => {
    const parent = {
      id: 'g-ann',
      name: 'Alpha',
      channels: [{ name: 'announcements', groupId: 'g-ann', order: 0 }],
      kind: 'squad' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    await expect(publishOutboundInviteAnnounce(parent, 'inv-1', 'npub-bob')).resolves.toBe(true);
    expect(sendDmMessage).toHaveBeenCalledWith(
      'g-ann',
      expect.stringContaining(SQUAD_OUTBOUND_INVITE_TYPE),
      '',
      { virtualBucket: 'announcements' },
    );
  });

  it('publishOutboundInviteAnnounce returns false without announcements gid', async () => {
    vi.mocked(getAnnouncementsChannel).mockReturnValue({
      name: 'announcements',
      groupId: '  ',
      order: 0,
    } as ReturnType<typeof getAnnouncementsChannel>);
    const parent = {
      id: 'g-ann',
      name: 'Alpha',
      channels: [],
      kind: 'squad' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    await expect(publishOutboundInviteAnnounce(parent, 'inv-1', 'npub-bob')).resolves.toBe(false);
    expect(sendDmMessage).not.toHaveBeenCalled();
  });

  it('publishInviteAcceptedClaims DMs distinct admitters', async () => {
    await publishInviteAcceptedClaims({
      parentId: 'g-ann',
      inviteId: 'inv-1',
      inviteeNpub: 'npub-bob',
      squadName: 'Alpha',
      admitterNpubs: ['npub-me', 'npub-me', ' npub-other ', 'npub-bob', ''],
    });
    expect(sendDmMessage).toHaveBeenCalledTimes(2);
    expect(sendDmMessage).toHaveBeenCalledWith('npub-me', expect.any(String));
    expect(sendDmMessage).toHaveBeenCalledWith('npub-other', expect.any(String));
  });

  it('publishInviteAcceptedClaims sends claim DMs concurrently', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const gate = Promise.withResolvers<void>();
    vi.mocked(sendDmMessage).mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate.promise;
      inFlight -= 1;
      return true;
    });
    const done = publishInviteAcceptedClaims({
      parentId: 'g-ann',
      inviteId: 'inv-1',
      inviteeNpub: 'npub-bob',
      squadName: 'Alpha',
      admitterNpubs: ['npub-a', 'npub-b'],
    });
    await vi.waitFor(() => expect(maxInFlight).toBe(2));
    gate.resolve();
    await done;
    expect(sendDmMessage).toHaveBeenCalledTimes(2);
  });

  it('handleInviteeConsentForAdmit enqueues retry on failure and does not storm', async () => {
    rememberOutboundInvite(validOutbound);
    vi.mocked(admitMemberToSquad).mockResolvedValue({
      ok: false,
      announcementsOk: false,
      openChannelsInvited: 0,
      error: 'network down',
    });
    await handleInviteeConsentForAdmit(validOutbound);
    expect(admitMemberToSquad).toHaveBeenCalledTimes(1);
    expect(enqueuePendingAdmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'invite',
        parentId: 'g-ann',
        memberNpub: 'npub-bob',
        inviteId: 'inv-1',
      }),
    );

    // A second broadcast for the same invite must be suppressed; durable drain retries.
    await handleInviteeConsentForAdmit(validOutbound);
    expect(admitMemberToSquad).toHaveBeenCalledTimes(1);
  });

  it('enqueues a durable retry when admit throws', async () => {
    rememberOutboundInvite(validOutbound);
    vi.mocked(admitMemberToSquad).mockRejectedValueOnce(new Error('relay unavailable'));

    await expect(handleInviteeConsentForAdmit(validOutbound)).resolves.toBeUndefined();

    expect(enqueuePendingAdmit).toHaveBeenCalledWith(
      expect.objectContaining({
        inviteId: 'inv-1',
        lastError: 'relay unavailable',
      }),
    );
  });

  it('handleInviteeConsentForAdmit rejects unvalidated DM claims', async () => {
    await handleInviteeConsentForAdmit(validOutbound);
    expect(admitMemberToSquad).not.toHaveBeenCalled();
  });

  it('rejects a tampered invitee for a known invite id', async () => {
    rememberOutboundInvite(validOutbound);
    await handleInviteeConsentForAdmit({ ...validOutbound, invitee_npub: 'npub-mallory' });
    expect(admitMemberToSquad).not.toHaveBeenCalled();
  });

  it('finds a cold outbound invite beyond the first history page', async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      content: `message-${index}`,
    }));
    vi.mocked(getDmMessages)
      .mockResolvedValueOnce(firstPage as never)
      .mockResolvedValueOnce([{ content: formatSquadOutboundInvite(validOutbound) }] as never);

    await handleInviteeConsentForAdmit(validOutbound);

    expect(getDmMessages).toHaveBeenNthCalledWith(
      2,
      'g-ann',
      200,
      200,
      { virtualBucketFilter: 'announcements' },
    );
    expect(admitMemberToSquad).toHaveBeenCalledOnce();
  });

  it('handleInviteeConsentForAdmit admits once and can broadcast admit_needed', async () => {
    rememberOutboundInvite(validOutbound);
    await handleInviteeConsentForAdmit(validOutbound, { broadcastAdmitNeeded: true });
    expect(admitMemberToSquad).toHaveBeenCalledWith({
      parent: expect.objectContaining({ id: 'g-ann' }),
      memberNpub: 'npub-bob',
    });
    expect(sendDmMessage).toHaveBeenCalledWith(
      'g-ann',
      expect.stringContaining(SQUAD_ADMIT_NEEDED_TYPE),
      '',
      { virtualBucket: 'announcements' },
    );

    await handleInviteeConsentForAdmit(validOutbound, { broadcastAdmitNeeded: true });
    expect(admitMemberToSquad).toHaveBeenCalledTimes(1);
  });

  it('handleInviteeConsentForAdmit skips self and missing user', async () => {
    rememberOutboundInvite(validOutbound);
    await handleInviteeConsentForAdmit({ ...validOutbound, invitee_npub: 'npub-me' });
    expect(admitMemberToSquad).not.toHaveBeenCalled();

    currentUser.set(null as never);
    await handleInviteeConsentForAdmit(validOutbound);
    expect(admitMemberToSquad).not.toHaveBeenCalled();
  });

  it('onMls helpers remember outbound and route admit_needed', async () => {
    onMlsOutboundInviteAnnounce(formatSquadOutboundInvite(validOutbound));
    onMlsAdmitNeeded(formatSquadAdmitNeeded(validOutbound), 'g-ann');
    await vi.waitFor(() => {
      expect(admitMemberToSquad).toHaveBeenCalled();
    });
    onMlsAdmitNeeded(formatSquadAdmitNeeded(validOutbound), 'other-group');
  });

  it('rejects an MLS admit_needed without a matching outbound invite', async () => {
    onMlsAdmitNeeded(formatSquadAdmitNeeded(validOutbound), 'g-ann');
    await vi.waitFor(() => expect(getDmMessages).toHaveBeenCalled());
    expect(admitMemberToSquad).not.toHaveBeenCalled();
  });
});
