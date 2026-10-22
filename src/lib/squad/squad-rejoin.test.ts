import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/nostr', () => ({
  acceptMlsWelcome: vi.fn(),
  getMlsGroupMembers: vi.fn(),
  getMlsGroupMetadata: vi.fn(),
  listPendingMlsWelcomes: vi.fn(),
  parseChannelInSquadMessage: (content: string) => {
    const parsed = JSON.parse(content) as { type?: string };
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

import {
  acceptMlsWelcome,
  getMlsGroupMembers,
  getMlsGroupMetadata,
  listPendingMlsWelcomes,
  sendDmMessage,
  type PendingMlsWelcome,
} from '../api/nostr';
import { acceptStagedChannelWelcome, finalizeSquadAfterAnnouncementsWelcome } from '../invites/accept-invite';
import { restoreMemberToSquad } from '../parent/restore-squad-access';
import { backendDmMessages } from '../../stores/dm';
import {
  acceptedSquadInviteIds,
  declinedSquadInviteIds,
  declinedWelcomeGroupIds,
} from '../../stores/invite-decisions';
import {
  SQUAD_REJOIN_PENDING_PREFIX,
  formatSquadRejoinRequest,
  handleSquadRejoinRequest,
  noteRejoinChannelDm,
  parseSquadRejoinRequest,
  planSquadRejoinRequests,
  requestSquadRejoinForInvite,
  resetSquadRejoinState,
  scanSquadRejoinAfterBackfill,
  tryAcceptRememberedRejoinWelcomes,
} from './squad-rejoin';

const PENDING_KEY = `${SQUAD_REJOIN_PENDING_PREFIX}_npub1me`;
const DAY = 24 * 60 * 60 * 1000;

function invite(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'squad_invite',
    squadName: 'Alpha',
    groupId: 'g-ann',
    admitterNpubs: ['npub1admin', 'npub1me'],
    ...overrides,
  });
}

function channelHint(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'channel_in_squad',
    squadName: 'Alpha',
    announcementsGroupId: 'g-ann',
    channelGroupId: 'g-ops',
    channelName: 'ops',
    ...overrides,
  });
}

function welcome(groupId: string, welcomer: string, id = `w-${groupId}-${welcomer}`): PendingMlsWelcome {
  return {
    id,
    wrapper_event_id: `wrap-${id}`,
    nostr_group_id: groupId,
    group_name: groupId,
    group_description: null,
    group_admin_pubkeys: [],
    group_relays: [],
    welcomer,
    member_count: 2,
  };
}

describe('planSquadRejoinRequests', () => {
  const base = { selfNpub: 'npub1me', localGroupIds: ['g-already'], requireAccepted: true };

  it('plans only accepted, received, undeclined invites and attaches admin-sent hints', () => {
    const planned = planSquadRejoinRequests({
      ...base,
      acceptedInviteMessageIds: new Set(['m-alpha', 'm-joined', 'm-declined-msg', 'm-declined-group', 'm-mine']),
      declinedInviteMessageIds: new Set(['m-declined-msg']),
      declinedGroupIds: ['g-declined-group'],
      threads: [
        {
          peerNpub: 'npub1peer',
          messages: [
            { id: 'm-alpha', content: invite() },
            { id: 'm-hint', content: channelHint() },
            { id: 'm-joined', content: invite({ squadName: 'Joined', groupId: 'g-already' }) },
            { id: 'm-never', content: invite({ squadName: 'Never', groupId: 'g-never' }) },
            { id: 'm-declined-msg', content: invite({ groupId: 'g-declined-msg' }) },
            { id: 'm-declined-group', content: invite({ groupId: 'g-declined-group' }) },
            { id: 'm-mine', mine: true, content: invite({ groupId: 'g-mine' }) },
            { id: 'm-orphan-hint', content: channelHint({ announcementsGroupId: 'g-unknown' }) },
          ],
        },
      ],
    });
    expect(planned.map((p) => p.parentId)).toEqual(['g-ann']);
    expect(planned[0].targets).toEqual(['npub1admin', 'npub1peer']);
    expect(planned[0].channelGroupIds).toEqual(['g-ops']);
  });

  it('caps admitter targets and never targets self', () => {
    const planned = planSquadRejoinRequests({
      ...base,
      acceptedInviteMessageIds: new Set(['m1']),
      threads: [
        {
          peerNpub: 'npub1peer',
          messages: [
            {
              id: 'm1',
              content: invite({
                admitterNpubs: ['npub1a', 'npub1b', 'npub1c', 'npub1d', 'npub1me'],
              }),
            },
          ],
        },
      ],
    });
    expect(planned[0].targets).toEqual(['npub1a', 'npub1b', 'npub1c', 'npub1peer']);
  });

  it('falls back to the DM peer when the invite names no admitters', () => {
    const planned = planSquadRejoinRequests({
      ...base,
      acceptedInviteMessageIds: new Set(['m1']),
      threads: [{ peerNpub: 'npub1peer', messages: [{ id: 'm1', content: invite({ admitterNpubs: [] }) }] }],
    });
    expect(planned[0].targets).toEqual(['npub1peer']);
  });

  it('plans a single unaccepted invite on user request', () => {
    const planned = planSquadRejoinRequests({
      ...base,
      requireAccepted: false,
      onlyParentId: 'G-ANN',
      threads: [
        {
          peerNpub: 'npub1peer',
          messages: [
            { id: 'm1', content: invite() },
            { id: 'm2', content: invite({ groupId: 'g-other' }) },
          ],
        },
      ],
    });
    expect(planned.map((p) => p.parentId)).toEqual(['g-ann']);
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

  it('does not parse the removed relay message', () => {
    expect(
      parseSquadRejoinRequest(
        JSON.stringify({
          type: 'squad_rejoin_needed',
          payload: { parent_id: 'g', requester_npub: 'npub1bob', request_id: 'r' },
        }),
      ),
    ).toBeNull();
  });
});

function stubStorage(): Map<string, string> {
  const storage = new Map<string, string>();
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
  return storage;
}

describe('handleSquadRejoinRequest', () => {
  const payload = {
    parent_id: 'g-ann',
    requester_npub: 'npub1bob',
    request_id: 'r1',
  };

  beforeEach(() => {
    resetSquadRejoinState();
    stubStorage();
    vi.mocked(getMlsGroupMembers).mockReset();
    vi.mocked(sendDmMessage).mockReset().mockResolvedValue(true);
    vi.mocked(restoreMemberToSquad).mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function mockMembership(members: string[], admins: string[]): void {
    vi.mocked(getMlsGroupMembers).mockResolvedValue({
      group_id: 'g-ann',
      members,
      admins,
      pending_welcomes: [],
    });
  }

  it('ignores a request whose DM sender is not the requester', async () => {
    mockMembership(['npub1me', 'npub1bob'], ['npub1me']);
    await handleSquadRejoinRequest(payload, 'npub1mallory');
    expect(getMlsGroupMembers).not.toHaveBeenCalled();
    expect(restoreMemberToSquad).not.toHaveBeenCalled();
  });

  it('ignores a requester who has no leaf', async () => {
    mockMembership(['npub1me'], ['npub1me']);
    await handleSquadRejoinRequest(payload, 'npub1bob');
    expect(restoreMemberToSquad).not.toHaveBeenCalled();
  });

  it('does nothing when this device is a member but not an admin, and never relays', async () => {
    mockMembership(['npub1me', 'npub1bob'], ['npub1admin']);
    await handleSquadRejoinRequest(payload, 'npub1bob');
    expect(restoreMemberToSquad).not.toHaveBeenCalled();
    expect(sendDmMessage).not.toHaveBeenCalled();
  });

  it('restores the squad when this device is an MLS admin and the sender is the requester', async () => {
    mockMembership(['npub1me', 'npub1bob'], ['npub1me']);
    await handleSquadRejoinRequest(payload, 'NPUB1BOB');
    expect(restoreMemberToSquad).toHaveBeenCalledWith({
      parent: expect.objectContaining({ id: 'g-ann' }),
      memberNpub: 'npub1bob',
    });
  });

  it('dedupes a repeated request for ten minutes, then allows another restore', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    mockMembership(['npub1me', 'npub1bob'], ['npub1me']);
    await handleSquadRejoinRequest(payload, 'npub1bob');
    await handleSquadRejoinRequest({ ...payload, request_id: 'r2' }, 'npub1bob');
    expect(restoreMemberToSquad).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_000 + 11 * 60 * 1000);
    await handleSquadRejoinRequest({ ...payload, request_id: 'r3' }, 'npub1bob');
    expect(restoreMemberToSquad).toHaveBeenCalledTimes(2);
  });

  it('does not mark a failed restore as handled', async () => {
    mockMembership(['npub1me', 'npub1bob'], ['npub1me']);
    vi.mocked(restoreMemberToSquad).mockResolvedValueOnce({ ok: false, error: 'offline' });
    await handleSquadRejoinRequest(payload, 'npub1bob');
    await handleSquadRejoinRequest(payload, 'npub1bob');
    expect(restoreMemberToSquad).toHaveBeenCalledTimes(2);
  });
});

describe('requester lifecycle', () => {
  let storage: Map<string, string>;

  function rows(): Array<Record<string, unknown>> {
    return JSON.parse(storage.get(PENDING_KEY) ?? '[]') as Array<Record<string, unknown>>;
  }

  function setInviteThread(extra: Array<{ id: string; mine?: boolean; content: string }> = []): void {
    backendDmMessages.set({
      npub1peer: [{ id: 'm-invite', content: invite() }, ...extra] as never,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    resetSquadRejoinState();
    storage = stubStorage();
    acceptedSquadInviteIds.set(['m-invite']);
    declinedSquadInviteIds.set([]);
    declinedWelcomeGroupIds.set([]);
    setInviteThread();
    vi.mocked(getMlsGroupMetadata).mockReset().mockResolvedValue([]);
    vi.mocked(listPendingMlsWelcomes).mockReset().mockResolvedValue([]);
    vi.mocked(sendDmMessage).mockReset().mockResolvedValue(true);
    vi.mocked(acceptMlsWelcome).mockReset().mockResolvedValue(true);
    vi.mocked(acceptStagedChannelWelcome).mockReset().mockResolvedValue(undefined);
    vi.mocked(finalizeSquadAfterAnnouncementsWelcome).mockReset();
  });

  afterEach(() => {
    resetSquadRejoinState();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asks one target per attempt, rotating, with backoff between attempts', async () => {
    await scanSquadRejoinAfterBackfill();
    expect(sendDmMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendDmMessage).mock.calls[0][0]).toBe('npub1admin');

    await scanSquadRejoinAfterBackfill();
    expect(sendDmMessage).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000_000 + 60_000);
    await scanSquadRejoinAfterBackfill();
    expect(sendDmMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendDmMessage).mock.calls[1][0]).toBe('npub1peer');
  });

  it('sends nothing for an invite with no recorded accept', async () => {
    acceptedSquadInviteIds.set([]);
    await scanSquadRejoinAfterBackfill();
    expect(sendDmMessage).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
  });

  it('keeps asking through the first fourteen days', async () => {
    await scanSquadRejoinAfterBackfill();
    vi.setSystemTime(1_000_000 + 13 * DAY);
    await scanSquadRejoinAfterBackfill();
    expect(rows()[0]?.phase).toBe('requesting');
    expect(vi.mocked(sendDmMessage).mock.calls.length).toBe(2);
  });

  it('abandons an expired request and does not re-plan it on the next launch', async () => {
    await scanSquadRejoinAfterBackfill();
    vi.setSystemTime(1_000_000 + 15 * DAY);
    await scanSquadRejoinAfterBackfill();
    expect(rows()[0]?.phase).toBe('abandoned');
    const sent = vi.mocked(sendDmMessage).mock.calls.length;

    resetSquadRejoinState();
    vi.setSystemTime(1_000_000 + 16 * DAY);
    await scanSquadRejoinAfterBackfill();
    expect(vi.mocked(sendDmMessage).mock.calls.length).toBe(sent);
  });

  it('keeps the row after announcements join and accepts a late channel welcome from the restorer', async () => {
    await scanSquadRejoinAfterBackfill();
    vi.mocked(listPendingMlsWelcomes).mockResolvedValue([welcome('g-ann', 'npub1admin')]);
    vi.mocked(getMlsGroupMetadata)
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ group_id: 'g-ann' }] as never);
    await scanSquadRejoinAfterBackfill();
    expect(acceptMlsWelcome).toHaveBeenCalledTimes(1);
    expect(finalizeSquadAfterAnnouncementsWelcome).toHaveBeenCalled();
    expect(rows()[0]?.phase).toBe('channels');

    vi.setSystemTime(1_000_000 + 10 * 60 * 1000);
    vi.mocked(listPendingMlsWelcomes).mockResolvedValue([welcome('g-ops', 'npub1admin')]);
    noteRejoinChannelDm(channelHint(), 'npub1admin');
    await vi.waitFor(() => expect(acceptStagedChannelWelcome).toHaveBeenCalledTimes(1));
    expect(acceptStagedChannelWelcome).toHaveBeenCalledWith(
      expect.objectContaining({ channelGroupId: 'g-ops', parentId: 'g-ann', channelName: 'ops' }),
    );
    expect(vi.mocked(sendDmMessage).mock.calls.length).toBe(1);
  });

  it('drops the channel window after it expires', async () => {
    await scanSquadRejoinAfterBackfill();
    vi.mocked(listPendingMlsWelcomes).mockResolvedValue([welcome('g-ann', 'npub1admin')]);
    vi.mocked(getMlsGroupMetadata)
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ group_id: 'g-ann' }] as never);
    await scanSquadRejoinAfterBackfill();
    expect(rows()[0]?.phase).toBe('channels');
    vi.setSystemTime(1_000_000 + 2 * DAY);
    await scanSquadRejoinAfterBackfill();
    expect(rows()).toEqual([]);
  });

  it('rejects an announcements welcome from a welcomer that was not asked', async () => {
    await scanSquadRejoinAfterBackfill();
    vi.mocked(listPendingMlsWelcomes).mockResolvedValue([welcome('g-ann', 'npub1mallory')]);
    await tryAcceptRememberedRejoinWelcomes();
    expect(acceptMlsWelcome).not.toHaveBeenCalled();
    expect(rows()[0]?.phase).toBe('requesting');
  });

  it('skips a failing welcome and accepts the next trusted one', async () => {
    await scanSquadRejoinAfterBackfill();
    vi.mocked(listPendingMlsWelcomes).mockResolvedValue([
      welcome('g-ann', 'npub1admin', 'stale'),
      welcome('g-ann', 'npub1admin', 'fresh'),
    ]);
    vi.mocked(acceptMlsWelcome).mockRejectedValueOnce(new Error('stale welcome'));
    await tryAcceptRememberedRejoinWelcomes();
    expect(vi.mocked(acceptMlsWelcome).mock.calls.map((c) => c[0])).toEqual(['stale', 'fresh']);
    expect(rows()[0]?.phase).toBe('channels');
  });

  it('rejects a channel welcome from an untrusted welcomer and a hint from an untrusted sender', async () => {
    await scanSquadRejoinAfterBackfill();
    vi.mocked(listPendingMlsWelcomes).mockResolvedValue([welcome('g-ann', 'npub1admin')]);
    await tryAcceptRememberedRejoinWelcomes();

    vi.mocked(listPendingMlsWelcomes).mockResolvedValue([welcome('g-evil', 'npub1mallory')]);
    noteRejoinChannelDm(channelHint({ channelGroupId: 'g-evil', channelName: 'evil' }), 'npub1mallory');
    await tryAcceptRememberedRejoinWelcomes();
    expect(rows()[0]?.channelGroupIds).toEqual([]);
    expect(acceptStagedChannelWelcome).not.toHaveBeenCalled();

    // A hint from the trusted restorer names the channel, but a welcome from anyone else is still refused.
    vi.mocked(listPendingMlsWelcomes).mockResolvedValue([welcome('g-ops', 'npub1mallory')]);
    noteRejoinChannelDm(channelHint({ channelGroupId: 'g-ops' }), 'npub1admin');
    await tryAcceptRememberedRejoinWelcomes();
    expect(acceptStagedChannelWelcome).not.toHaveBeenCalled();
  });

  it('ignores corrupt persisted rows and rows without valid targets', async () => {
    storage.set(
      PENDING_KEY,
      JSON.stringify([
        { parentId: 'g-bad', requestId: 'r', targets: ['bob'] },
        { parentId: 'g-ann', requestId: 'r', targets: ['npub1admin'], phase: 'nonsense', attempts: 'x' },
        null,
      ]),
    );
    await scanSquadRejoinAfterBackfill();
    const saved = rows();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ parentId: 'g-ann', phase: 'requesting' });
  });

  it('requests restore for an invite with no recorded accept, resetting a tombstone', async () => {
    acceptedSquadInviteIds.set([]);
    storage.set(
      PENDING_KEY,
      JSON.stringify([
        {
          parentId: 'g-ann',
          squadName: 'Alpha',
          targets: ['npub1admin'],
          channelGroupIds: [],
          requestId: 'old',
          phase: 'abandoned',
          attempts: 64,
          lastAttemptAt: 1,
          createdAt: 1,
          joinedAt: 0,
          trustedWelcomers: [],
        },
      ]),
    );
    expect(await requestSquadRejoinForInvite('g-ann')).toBe(true);
    expect(sendDmMessage).toHaveBeenCalledTimes(1);
    expect(rows()[0]).toMatchObject({ phase: 'requesting', attempts: 1 });
    expect(rows()[0]?.requestId).not.toBe('old');
  });

  it('refuses to request restore for a declined invite', async () => {
    acceptedSquadInviteIds.set([]);
    declinedSquadInviteIds.set(['m-invite']);
    expect(await requestSquadRejoinForInvite('g-ann')).toBe(false);
    expect(sendDmMessage).not.toHaveBeenCalled();
  });
});
