import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../api/nostr', () => ({
  sendDmMessage: vi.fn(),
  getDmMessages: vi.fn().mockResolvedValue([]),
  getMlsGroupMembers: vi.fn().mockResolvedValue({
    group_id: 'g-ann',
    members: [],
    admins: [],
    pending_welcomes: [],
  }),
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

vi.mock('../../stores/squad-outbound-invites', () => ({
  removePendingOutboundInvite: vi.fn(),
  syncOutboundInvitesForSquad: vi.fn(),
}));

vi.mock('../governance/squad-privilege-enforce', () => ({
  decideSquadPrivilege: vi.fn(),
  requireMySquadPrivilege: vi.fn(),
}));

vi.mock('../../stores/auth-session', async () => {
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

import { getDmMessages, getMlsGroupMembers, sendDmMessage } from '../api/nostr';
import { decideSquadPrivilege, requireMySquadPrivilege } from '../governance/squad-privilege-enforce';
import { getAnnouncementsChannel } from '../parent-navbar';
import { admitMemberToSquad } from '../parent/admit-member';
import { enqueuePendingAdmit } from '../parent/pending-admit';
import { currentUser } from '../../stores/auth-session';
import { squads } from '../../stores/squads';
import {
  formatSquadAdmitNeeded,
  formatSquadInviteAccepted,
  formatSquadInviteDeclined,
  formatSquadOutboundInvite,
  formatSquadOutboundInviteDeclined,
  formatSquadOutboundInviteRevoked,
  handleInviteeConsentForAdmit,
  handleInviteeDeclineForAnnounce,
  isOutboundInviteRevoked,
  loadPendingOutboundInvitesFromMls,
  mergePendingOutboundInvitesFromMlsMessages,
  onMlsAdmitNeeded,
  onMlsOutboundInviteAnnounce,
  onMlsOutboundInviteDeclined,
  onMlsOutboundInviteRevoked,
  parseSquadAdmitNeeded,
  parseSquadInviteAccepted,
  parseSquadInviteDeclined,
  parseSquadOutboundInvite,
  parseSquadOutboundInviteDeclined,
  parseSquadOutboundInviteRevoked,
  publishInviteAcceptedClaims,
  publishInviteDeclinedClaims,
  publishOutboundInviteAnnounce,
  rememberOutboundInvite,
  resetOutboundInviteState,
  revokeOutboundInviteAnnounce,
  SQUAD_ADMIT_NEEDED_TYPE,
  SQUAD_INVITE_ACCEPTED_TYPE,
  SQUAD_INVITE_DECLINED_TYPE,
  SQUAD_OUTBOUND_INVITE_DECLINED_TYPE,
  SQUAD_OUTBOUND_INVITE_REVOKED_TYPE,
  SQUAD_OUTBOUND_INVITE_TYPE,
} from './squad-outbound-invite';

const ALLOWED = { ok: true, active: true, flags: null } as const;
const DENIED = { ok: false, reason: 'denied', active: true } as const;
const UNBOUND = { ok: false, reason: 'unbound', active: true } as const;
const RPC_FAILED = { ok: false, reason: 'rpc', active: true } as const;

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

  it('round-trips outbound invite revoked format/parse', () => {
    const payload = {
      parent_id: 'g-ann',
      invite_id: 'inv-1',
      invitee_npub: 'npub-bob',
    };
    const raw = formatSquadOutboundInviteRevoked(payload);
    expect(JSON.parse(raw).type).toBe(SQUAD_OUTBOUND_INVITE_REVOKED_TYPE);
    expect(parseSquadOutboundInviteRevoked(raw)).toEqual(payload);
  });

  it('rejects invalid revoked payloads', () => {
    expect(parseSquadOutboundInviteRevoked(null)).toBeNull();
    expect(
      parseSquadOutboundInviteRevoked(
        JSON.stringify({ type: SQUAD_OUTBOUND_INVITE_REVOKED_TYPE, payload: { parent_id: 'p' } }),
      ),
    ).toBeNull();
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

  it('round-trips outbound invite declined format/parse', () => {
    const payload = {
      parent_id: 'g-ann',
      invite_id: 'inv-1',
      invitee_npub: 'npub-bob',
    };
    const raw = formatSquadOutboundInviteDeclined(payload);
    expect(JSON.parse(raw).type).toBe(SQUAD_OUTBOUND_INVITE_DECLINED_TYPE);
    expect(parseSquadOutboundInviteDeclined(raw)).toEqual(payload);
  });

  it('rejects invalid MLS declined payloads', () => {
    expect(parseSquadOutboundInviteDeclined(null)).toBeNull();
    expect(
      parseSquadOutboundInviteDeclined(
        JSON.stringify({ type: SQUAD_OUTBOUND_INVITE_DECLINED_TYPE, payload: { parent_id: 'p' } }),
      ),
    ).toBeNull();
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

  it('round-trips invite declined format/parse', () => {
    const raw = formatSquadInviteDeclined(validOutbound);
    expect(JSON.parse(raw).type).toBe(SQUAD_INVITE_DECLINED_TYPE);
    expect(parseSquadInviteDeclined(raw)).toEqual(validOutbound);
  });

  it('rejects invalid invite declined payloads', () => {
    expect(parseSquadInviteDeclined(undefined)).toBeNull();
    expect(parseSquadInviteDeclined('plain')).toBeNull();
    expect(parseSquadInviteDeclined('{bad')).toBeNull();
    expect(parseSquadInviteDeclined(JSON.stringify({ type: 'other' }))).toBeNull();
    expect(
      parseSquadInviteDeclined(JSON.stringify({ type: SQUAD_INVITE_DECLINED_TYPE })),
    ).toBeNull();
    expect(
      parseSquadInviteDeclined(
        JSON.stringify({
          type: SQUAD_INVITE_DECLINED_TYPE,
          payload: { parent_id: '', invite_id: 'i', invitee_npub: 'n', squad_name: 's' },
        }),
      ),
    ).toBeNull();
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
    resetOutboundInviteState();
    vi.mocked(sendDmMessage).mockReset().mockResolvedValue(true);
    vi.mocked(getDmMessages).mockReset().mockResolvedValue([]);
    vi.mocked(decideSquadPrivilege)
      .mockReset()
      .mockResolvedValue({ ok: true, active: false, flags: null });
    vi.mocked(requireMySquadPrivilege)
      .mockReset()
      .mockResolvedValue({ ok: true, active: false, flags: null });
    vi.mocked(getMlsGroupMembers).mockReset().mockResolvedValue({
      group_id: 'g-ann',
      members: [],
      admins: [],
      pending_welcomes: [],
    });
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

  it('publishInviteDeclinedClaims DMs distinct admitters', async () => {
    await expect(
      publishInviteDeclinedClaims({
        parentId: 'g-ann',
        inviteId: 'inv-1',
        inviteeNpub: 'npub-bob',
        squadName: 'Alpha',
        admitterNpubs: ['npub-me', 'npub-me', ' npub-other ', 'npub-bob', ''],
      }),
    ).resolves.toBe(true);
    expect(sendDmMessage).toHaveBeenCalledTimes(2);
    expect(sendDmMessage).toHaveBeenCalledWith('npub-me', expect.stringContaining(SQUAD_INVITE_DECLINED_TYPE));
    expect(sendDmMessage).toHaveBeenCalledWith('npub-other', expect.stringContaining(SQUAD_INVITE_DECLINED_TYPE));
  });

  it('publishInviteDeclinedClaims reports failure when every DM send fails', async () => {
    vi.mocked(sendDmMessage).mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await expect(
      publishInviteDeclinedClaims({
        parentId: 'g-ann',
        inviteId: 'inv-1',
        inviteeNpub: 'npub-bob',
        squadName: 'Alpha',
        admitterNpubs: ['npub-me', 'npub-other'],
      }),
    ).resolves.toBe(false);
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

  it('mergePendingOutboundInvitesFromMlsMessages drops declined invites', () => {
    const pending = mergePendingOutboundInvitesFromMlsMessages([
      { content: formatSquadOutboundInvite(validOutbound), at: 10 },
      {
        content: formatSquadOutboundInviteDeclined({
          parent_id: 'g-ann',
          invite_id: 'inv-1',
          invitee_npub: 'npub-bob',
        }),
        at: 20,
      },
    ]);
    expect(pending).toEqual([]);
    expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(true);
  });

  it('mergePendingOutboundInvitesFromMlsMessages sorts by at before applying a decline listed first', () => {
    const pending = mergePendingOutboundInvitesFromMlsMessages([
      {
        content: formatSquadOutboundInviteDeclined({
          parent_id: 'g-ann',
          invite_id: 'inv-1',
          invitee_npub: 'npub-bob',
        }),
        at: 20,
      },
      { content: formatSquadOutboundInvite(validOutbound), at: 10 },
    ]);
    expect(pending).toEqual([]);
    expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(true);
  });

  it('mergePendingOutboundInvitesFromMlsMessages drops revoked invites', () => {
    const pending = mergePendingOutboundInvitesFromMlsMessages([
      { content: formatSquadOutboundInvite(validOutbound), at: 10 },
      {
        content: formatSquadOutboundInviteRevoked({
          parent_id: 'g-ann',
          invite_id: 'inv-1',
          invitee_npub: 'npub-bob',
        }),
        at: 20,
      },
    ]);
    expect(pending).toEqual([]);
    expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(true);
  });

  it('mergePendingOutboundInvitesFromMlsMessages keeps latest invite when not revoked', () => {
    const pending = mergePendingOutboundInvitesFromMlsMessages([
      { content: formatSquadOutboundInvite(validOutbound), at: 10 },
      {
        content: formatSquadOutboundInvite({ ...validOutbound, invite_id: 'inv-2', invitee_npub: 'npub-cara' }),
        at: 30,
      },
    ]);
    expect(pending.map((p) => p.inviteId)).toEqual(['inv-2', 'inv-1']);
  });

  it('loadPendingOutboundInvitesFromMls filters roster members', async () => {
    vi.mocked(getDmMessages).mockResolvedValue([
      { content: formatSquadOutboundInvite(validOutbound), at: 10 },
      {
        content: formatSquadOutboundInvite({
          ...validOutbound,
          invite_id: 'inv-2',
          invitee_npub: 'npub-cara',
        }),
        at: 20,
      },
    ] as never);
    vi.mocked(getMlsGroupMembers).mockResolvedValue({
      group_id: 'g-ann',
      members: ['npub-bob'],
      admins: [],
      pending_welcomes: [],
    });

    const pending = await loadPendingOutboundInvitesFromMls('g-ann');
    expect(pending).toEqual([
      expect.objectContaining({ inviteId: 'inv-2', inviteeNpub: 'npub-cara' }),
    ]);
  });

  it('revokeOutboundInviteAnnounce publishes revoke and blocks later admit', async () => {
    const parent = {
      id: 'g-ann',
      name: 'Alpha',
      channels: [{ name: 'announcements', groupId: 'g-ann', order: 0 }],
      kind: 'squad' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    rememberOutboundInvite(validOutbound);
    const ok = await revokeOutboundInviteAnnounce(parent, 'inv-1', 'npub-bob');
    expect(ok).toBe(true);
    expect(sendDmMessage).toHaveBeenCalledWith(
      'g-ann',
      expect.stringContaining(SQUAD_OUTBOUND_INVITE_REVOKED_TYPE),
      '',
      { virtualBucket: 'announcements' },
    );
    expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(true);

    await handleInviteeConsentForAdmit(validOutbound);
    expect(admitMemberToSquad).not.toHaveBeenCalled();
  });

  it('onMlsOutboundInviteRevoked remembers revoke', () => {
    rememberOutboundInvite(validOutbound);
    onMlsOutboundInviteRevoked(
      formatSquadOutboundInviteRevoked({
        parent_id: 'g-ann',
        invite_id: 'inv-1',
        invitee_npub: 'npub-bob',
      }),
    );
    expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(true);
  });

  it('onMlsOutboundInviteDeclined closes the invite', () => {
    rememberOutboundInvite(validOutbound);
    onMlsOutboundInviteDeclined(
      formatSquadOutboundInviteDeclined({
        parent_id: 'g-ann',
        invite_id: 'inv-1',
        invitee_npub: 'npub-bob',
      }),
    );
    expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(true);
  });

  it('handleInviteeDeclineForAnnounce publishes MLS decline for a known invite', async () => {
    rememberOutboundInvite(validOutbound);
    await handleInviteeDeclineForAnnounce(validOutbound, 'npub-bob');
    expect(sendDmMessage).toHaveBeenCalledWith(
      'g-ann',
      expect.stringContaining(SQUAD_OUTBOUND_INVITE_DECLINED_TYPE),
      '',
      { virtualBucket: 'announcements' },
    );
    expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(true);

    await handleInviteeConsentForAdmit(validOutbound);
    expect(admitMemberToSquad).not.toHaveBeenCalled();
  });

  it('handleInviteeDeclineForAnnounce ignores sender mismatch', async () => {
    rememberOutboundInvite(validOutbound);
    await handleInviteeDeclineForAnnounce(validOutbound, 'npub-mallory');
    expect(sendDmMessage).not.toHaveBeenCalled();
    expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(false);
  });

  it('handleInviteeDeclineForAnnounce ignores unknown invites', async () => {
    await handleInviteeDeclineForAnnounce(validOutbound, 'npub-bob');
    expect(sendDmMessage).not.toHaveBeenCalled();
  });

  it('handleInviteeDeclineForAnnounce does nothing without local inviteAccept privilege', async () => {
    vi.mocked(requireMySquadPrivilege).mockResolvedValue(DENIED);
    rememberOutboundInvite(validOutbound);
    await handleInviteeDeclineForAnnounce(validOutbound, 'npub-bob');
    expect(requireMySquadPrivilege).toHaveBeenCalledWith('g-ann', 'inviteAccept');
    expect(sendDmMessage).not.toHaveBeenCalled();
    expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(false);
  });

  it('handleInviteeDeclineForAnnounce skips invites already admitted', async () => {
    rememberOutboundInvite(validOutbound);
    await handleInviteeConsentForAdmit(validOutbound);
    expect(admitMemberToSquad).toHaveBeenCalledTimes(1);
    await handleInviteeDeclineForAnnounce(validOutbound, 'npub-bob');
    expect(sendDmMessage).not.toHaveBeenCalled();
  });

  it('handleInviteeDeclineForAnnounce leaves the invite open when the announce send fails', async () => {
    rememberOutboundInvite(validOutbound);
    vi.mocked(sendDmMessage).mockResolvedValueOnce(false);
    await handleInviteeDeclineForAnnounce(validOutbound, 'npub-bob');
    expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(false);

    vi.mocked(sendDmMessage).mockResolvedValue(true);
    await handleInviteeDeclineForAnnounce(validOutbound, 'npub-bob');
    expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(true);
    const mlsSends = vi
      .mocked(sendDmMessage)
      .mock.calls.filter(([target]) => target === 'g-ann');
    expect(mlsSends).toHaveLength(2);
  });

  it('handleInviteeDeclineForAnnounce publishes once for concurrent claims', async () => {
    rememberOutboundInvite(validOutbound);
    await Promise.all([
      handleInviteeDeclineForAnnounce(validOutbound, 'npub-bob'),
      handleInviteeDeclineForAnnounce(validOutbound, 'npub-bob'),
    ]);
    const mlsSends = vi
      .mocked(sendDmMessage)
      .mock.calls.filter(([target]) => target === 'g-ann');
    expect(mlsSends).toHaveLength(1);
  });

  it('handleInviteeDeclineForAnnounce waits for squads to hydrate', async () => {
    rememberOutboundInvite(validOutbound);
    const squad = get(squads)[0];
    squads.set([]);
    const pending = handleInviteeDeclineForAnnounce(validOutbound, 'npub-bob');
    squads.set([squad]);
    await pending;
    expect(sendDmMessage).toHaveBeenCalledWith(
      'g-ann',
      expect.stringContaining(SQUAD_OUTBOUND_INVITE_DECLINED_TYPE),
      '',
      { virtualBucket: 'announcements' },
    );
  });

  it('handleInviteeDeclineForAnnounce gives up when the squad never appears', async () => {
    vi.useFakeTimers();
    try {
      rememberOutboundInvite(validOutbound);
      squads.set([]);
      const pending = handleInviteeDeclineForAnnounce(validOutbound, 'npub-bob');
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
      expect(sendDmMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('squad-outbound-invite history author gate', () => {
  const closePayload = {
    parent_id: 'g-ann',
    invite_id: 'inv-1',
    invitee_npub: 'npub-bob',
  };
  const declinedRow = formatSquadOutboundInviteDeclined(closePayload);
  const revokedRow = formatSquadOutboundInviteRevoked(closePayload);

  beforeEach(() => {
    resetOutboundInviteState();
    vi.mocked(getDmMessages).mockReset().mockResolvedValue([]);
    vi.mocked(getMlsGroupMembers).mockReset().mockResolvedValue({
      group_id: 'g-ann',
      members: [],
      admins: [],
      pending_welcomes: [],
    });
    vi.mocked(admitMemberToSquad).mockReset().mockResolvedValue({
      ok: true,
      announcementsOk: true,
      openChannelsInvited: 0,
    });
    vi.mocked(decideSquadPrivilege)
      .mockReset()
      .mockImplementation(async ({ memberNpub }) => (memberNpub === 'npub-admin' ? ALLOWED : DENIED));
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

  it.each([
    ['decline', 'denied', declinedRow, DENIED],
    ['decline', 'unbound', declinedRow, UNBOUND],
    ['decline', 'rpc', declinedRow, RPC_FAILED],
    ['revoke', 'denied', revokedRow, DENIED],
    ['revoke', 'unbound', revokedRow, UNBOUND],
    ['revoke', 'rpc', revokedRow, RPC_FAILED],
  ] as const)(
    'keeps a %s when the close author is %s',
    async (_kind, _reason, closeRow, closeVerdict) => {
      vi.mocked(decideSquadPrivilege).mockImplementation(async ({ memberNpub }) =>
        memberNpub === 'npub-admin' ? ALLOWED : closeVerdict,
      );
      vi.mocked(getDmMessages).mockResolvedValue([
        { content: formatSquadOutboundInvite(validOutbound), at: 10, mine: false, npub: 'npub-admin' },
        { content: closeRow, at: 20, mine: false, npub: 'npub-former' },
      ] as never);
      await expect(loadPendingOutboundInvitesFromMls('g-ann')).resolves.toEqual([]);
      expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(true);

      resetOutboundInviteState();
      await handleInviteeConsentForAdmit(validOutbound);
      expect(admitMemberToSquad).not.toHaveBeenCalled();
      expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(true);
      expect(vi.mocked(decideSquadPrivilege).mock.calls.map(([p]) => p.memberNpub)).toEqual([
        'npub-admin',
        'npub-admin',
      ]);
    },
  );

  it('applies a decline authored by a privileged member', async () => {
    vi.mocked(getDmMessages).mockResolvedValue([
      { content: formatSquadOutboundInvite(validOutbound), at: 10, mine: false, npub: 'npub-admin' },
      { content: declinedRow, at: 20, mine: false, npub: 'npub-admin' },
    ] as never);
    await expect(loadPendingOutboundInvitesFromMls('g-ann')).resolves.toEqual([]);
    expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(true);
  });

  it('does not trust a forged invite announce when validating an accept claim', async () => {
    vi.mocked(getDmMessages).mockResolvedValue([
      { content: formatSquadOutboundInvite(validOutbound), at: 10, mine: false, npub: 'npub-mallory' },
    ] as never);
    await handleInviteeConsentForAdmit(validOutbound);
    expect(admitMemberToSquad).not.toHaveBeenCalled();
  });

  it('attributes own invites to the local user and unattributed invites to a missing author', async () => {
    vi.mocked(getDmMessages).mockResolvedValue([
      { content: formatSquadOutboundInvite(validOutbound), at: 10, mine: true },
      {
        content: formatSquadOutboundInvite({ ...validOutbound, invite_id: 'inv-2' }),
        at: 11,
        mine: false,
      },
    ] as never);
    await loadPendingOutboundInvitesFromMls('g-ann');
    const authors = vi.mocked(decideSquadPrivilege).mock.calls.map(([p]) => p.memberNpub);
    expect(authors).toEqual(['npub-me', '__missing__']);
  });

  it('does not apply an unattributed close', async () => {
    vi.mocked(getDmMessages).mockResolvedValue([
      { content: formatSquadOutboundInvite(validOutbound), at: 10, mine: false, npub: 'npub-admin' },
      { content: declinedRow, at: 20, mine: false },
    ] as never);
    const pending = await loadPendingOutboundInvitesFromMls('g-ann');
    expect(pending).toEqual([expect.objectContaining({ inviteId: 'inv-1' })]);
    expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(false);
    expect(vi.mocked(decideSquadPrivilege).mock.calls.map(([p]) => p.memberNpub)).toEqual([
      'npub-admin',
    ]);
  });

  it('checks each distinct invite author once and skips closes and other rows', async () => {
    vi.mocked(getDmMessages).mockResolvedValue([
      { content: 'hello', at: 5, mine: false, npub: 'npub-mallory' },
      { content: formatSquadOutboundInvite(validOutbound), at: 10, mine: false, npub: 'npub-admin' },
      {
        content: formatSquadOutboundInvite({ ...validOutbound, invite_id: 'inv-2' }),
        at: 11,
        mine: false,
        npub: 'npub-admin',
      },
      { content: declinedRow, at: 20, mine: false, npub: 'npub-mallory' },
    ] as never);
    const pending = await loadPendingOutboundInvitesFromMls('g-ann');
    expect(pending).toEqual([expect.objectContaining({ inviteId: 'inv-2' })]);
    expect(isOutboundInviteRevoked('g-ann', 'inv-1')).toBe(true);
    expect(decideSquadPrivilege).toHaveBeenCalledTimes(1);
  });
});
