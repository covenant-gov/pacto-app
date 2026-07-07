import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { DmMessage } from '../../stores/dm';
import { pactoAppInboxMessages } from '../../stores/dm';
import type { PendingMlsWelcome } from '../api/nostr';
import type { Squad } from '../../stores/app';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../squad/squad-catalog', () => ({
  persistSquad: vi.fn(),
  persistSquadPatch: vi.fn(),
}));

vi.mock('../utils/dm-debug', () => ({
  dmLog: vi.fn(),
  dmWarn: vi.fn(),
  dmError: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { persistSquad, persistSquadPatch } from '../squad/squad-catalog';
import { dmError } from '../utils/dm-debug';
import {
  acceptAnnouncementsInvite,
  acceptChannelInSquadInvite,
  acceptSquadOrPairInvite,
  acceptingChannelInSquadId,
  acceptingSquadInviteId,
  handleChannelAddedToSquad,
  handleMlsWelcomeAccepted,
  reconcileStaleInviteDecisions,
  resetInviteAcceptState,
  squadInviteResolvedByMembership,
} from './accept-invite';
import {
  acceptedChannelInviteMessageIds,
  acceptedSquadInviteIds,
  activeChannelId,
  activeHubChannelName,
  activeSquadId,
  activeTopNavTab,
  activeView,
  membershipVersionByGroupId,
  squads,
  ANNOUNCEMENTS_CHANNEL_NAME,
} from '../../stores/app';
import { pendingReadyToast } from '../../stores/toast';

let pendingWelcomes: PendingMlsWelcome[] = [];

const SQUAD_INVITE = JSON.stringify({
  type: 'squad_invite',
  squadName: 'Alpha',
  groupId: 'g1',
  kind: 'squad',
  invitedByNpub: 'npub1alice0000000',
});

const SQUAD_PAIR_INVITE = JSON.stringify({
  type: 'squad_invite',
  squadName: 'Pair',
  groupId: 'g2',
  kind: 'squad-pair',
  pairedSquads: [
    { id: 'anchor-a', name: 'A' },
    { id: 'anchor-b', name: 'B' },
  ],
});

function welcome(groupId: string): PendingMlsWelcome {
  return {
    id: `welcome-${groupId}`,
    wrapper_event_id: `wrapper-${groupId}`,
    nostr_group_id: groupId,
    group_name: 'Test',
    group_description: null,
    group_admin_pubkeys: [],
    group_relays: [],
    welcomer: 'npub1welcomer',
    member_count: 2,
  };
}

function dmMessage(overrides: Partial<DmMessage> = {}): DmMessage {
  return {
    id: 'msg-1',
    content: 'hello',
    at: 1,
    mine: false,
    ...overrides,
  };
}

const parent: Squad = {
  id: 'parent-1',
  name: 'Alpha',
  channels: [{ name: 'announcements', groupId: 'parent-1', order: 0 }],
  kind: 'squad',
  createdAt: 1,
  updatedAt: 1,
};

describe('accept-invite state reset', () => {
  it('clears accepting store state', () => {
    acceptingSquadInviteId.set('busy');
    acceptingChannelInSquadId.set('busy');
    resetInviteAcceptState();
    expect(get(acceptingSquadInviteId)).toBeNull();
    expect(get(acceptingChannelInSquadId)).toBeNull();
  });
});

describe('acceptAnnouncementsInvite', () => {
  beforeEach(() => {
    pendingWelcomes = [welcome('g1')];
    vi.mocked(invoke).mockReset().mockImplementation((command: string) => {
      if (command === 'list_pending_mls_welcomes') return Promise.resolve(pendingWelcomes);
      if (command === 'accept_mls_welcome') return Promise.resolve(true);
      if (command === 'sync_mls_groups_now') return Promise.resolve({ synced: 1, total: 1 });
      if (command === 'get_mls_group_members') return Promise.resolve({ group_id: 'g1', members: ['npub1a'], admins: [] });
      if (command === 'backfill_squad_member_evm_missing_from_profiles') return Promise.resolve(1);
      return Promise.resolve(undefined);
    });
    vi.mocked(persistSquad).mockReset().mockResolvedValue(undefined as unknown as Squad);
    vi.mocked(persistSquadPatch).mockReset().mockResolvedValue(undefined as unknown as Squad);
    vi.mocked(dmError).mockReset();
    squads.set([]);
    activeSquadId.set(null);
    activeChannelId.set(null);
    activeHubChannelName.set(null);
    activeTopNavTab.set('commons');
    activeView.set('hub');
    acceptedSquadInviteIds.set([]);
    acceptedChannelInviteMessageIds.set([]);
    membershipVersionByGroupId.set({});
    pendingReadyToast.set(null);
  });

  afterEach(() => {
    resetInviteAcceptState();
  });

  it('accepts a regular squad invite and updates navigation', async () => {
    await acceptAnnouncementsInvite({ groupId: 'g1', name: 'Alpha' }, 'msg-1');

    expect(invoke).toHaveBeenCalledWith('accept_mls_welcome', { welcomeEventIdHex: 'welcome-g1' });
    expect(invoke).toHaveBeenCalledWith('sync_mls_groups_now', { group_id: 'g1' });
    expect(invoke).toHaveBeenCalledWith('get_mls_group_members', { groupId: 'g1' });
    expect(invoke).toHaveBeenCalledWith('backfill_squad_member_evm_missing_from_profiles', {
      parentId: 'g1',
      memberNpubs: ['npub1a'],
    });

    expect(persistSquad).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'g1',
        name: 'Alpha',
        kind: 'squad',
      })
    );

    expect(get(squads).some((s) => s.id === 'g1')).toBe(true);
    expect(get(activeSquadId)).toBe('g1');
    expect(get(activeChannelId)).toBe('g1');
    expect(get(activeHubChannelName)).toBe(ANNOUNCEMENTS_CHANNEL_NAME);
    expect(get(activeTopNavTab)).toBe('squads');
    expect(get(activeView)).toBe('hub');
    expect(get(acceptedSquadInviteIds)).toContain('msg-1');
    expect(get(membershipVersionByGroupId).g1).toBe(1);

    const toast = get(pendingReadyToast);
    expect(toast?.text).toBe('Alpha is ready!');
    expect(toast?.goTo).toEqual(
      expect.objectContaining({
        type: 'squad',
        name: 'Alpha',
        id: 'g1',
        channelId: 'g1',
      })
    );
  });

  it('accepts a squad-pair invite and preserves paired squads', async () => {
    pendingWelcomes = [welcome('g2')];
    await acceptAnnouncementsInvite(
      {
        groupId: 'g2',
        name: 'Pair',
        memberSquads: [
          { id: 'anchor-a', name: 'A' },
          { id: 'anchor-b', name: 'B' },
        ],
      },
      'msg-2'
    );

    const stored = get(squads).find((s) => s.id === 'g2');
    expect(stored).toBeDefined();
    expect(stored?.kind).toBe('squad-pair');
    expect(stored?.pairedSquads).toEqual([
      { id: 'anchor-a', name: 'A' },
      { id: 'anchor-b', name: 'B' },
    ]);
  });

  it('throws a no-welcome error when there is no pending welcome', async () => {
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'list_pending_mls_welcomes') return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    await expect(acceptAnnouncementsInvite({ groupId: 'g1', name: 'Alpha' }, 'msg-1')).rejects.toMatchObject(
      { noWelcome: true }
    );
  });

  it('reverts the local squad when persistence fails', async () => {
    vi.mocked(persistSquad).mockRejectedValueOnce(new Error('db write failed'));

    await expect(acceptAnnouncementsInvite({ groupId: 'g1', name: 'Alpha' }, 'msg-1')).rejects.toThrow('db write failed');
    expect(get(squads).some((s) => s.id === 'g1')).toBe(false);
    expect(get(pendingReadyToast)).toBeNull();
  });
});

describe('acceptSquadOrPairInvite', () => {
  beforeEach(() => {
    pendingWelcomes = [welcome('g1')];
    vi.mocked(invoke).mockReset().mockImplementation((command: string) => {
      if (command === 'list_pending_mls_welcomes') return Promise.resolve(pendingWelcomes);
      if (command === 'accept_mls_welcome') return Promise.resolve(true);
      if (command === 'sync_mls_groups_now') return Promise.resolve({ synced: 1, total: 1 });
      if (command === 'get_mls_group_members') return Promise.resolve({ group_id: 'g1', members: [], admins: [] });
      if (command === 'backfill_squad_member_evm_missing_from_profiles') return Promise.resolve(0);
      return Promise.resolve(undefined);
    });
    vi.mocked(persistSquad).mockReset().mockResolvedValue(undefined as unknown as Squad);
    vi.mocked(persistSquadPatch).mockReset().mockResolvedValue(undefined as unknown as Squad);
    vi.mocked(dmError).mockReset();
    squads.set([]);
    activeSquadId.set(null);
    activeChannelId.set(null);
    activeHubChannelName.set(null);
    activeTopNavTab.set('commons');
    activeView.set('hub');
    acceptedSquadInviteIds.set([]);
    acceptedChannelInviteMessageIds.set([]);
    membershipVersionByGroupId.set({});
    pendingReadyToast.set(null);
    acceptingSquadInviteId.set(null);
    acceptingChannelInSquadId.set(null);
  });

  afterEach(() => {
    resetInviteAcceptState();
  });

  it('accepts a regular squad invite from a DM message', async () => {
    await acceptSquadOrPairInvite(dmMessage({ id: 'msg-1', content: SQUAD_INVITE }));
    expect(get(acceptingSquadInviteId)).toBeNull();
    expect(get(squads).some((s) => s.id === 'g1')).toBe(true);
  });

  it('accepts a squad-pair invite from a DM message', async () => {
    pendingWelcomes = [welcome('g2')];
    await acceptSquadOrPairInvite(dmMessage({ id: 'msg-2', content: SQUAD_PAIR_INVITE }));
    const stored = get(squads).find((s) => s.id === 'g2');
    expect(stored?.kind).toBe('squad-pair');
  });

  it('does nothing when content is not a squad invite', async () => {
    await acceptSquadOrPairInvite(dmMessage({ content: 'plain text' }));
    expect(get(squads)).toHaveLength(0);
    expect(get(acceptingSquadInviteId)).toBeNull();
  });

  it('does nothing when another squad invite is already being accepted', async () => {
    acceptingSquadInviteId.set('other');
    await acceptSquadOrPairInvite(dmMessage({ id: 'msg-1', content: SQUAD_INVITE }));
    expect(get(acceptingSquadInviteId)).toBe('other');
    expect(get(squads)).toHaveLength(0);
  });

  it('resets the accepting id even when acceptance fails', async () => {
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'list_pending_mls_welcomes') return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    await acceptSquadOrPairInvite(dmMessage({ id: 'msg-1', content: SQUAD_INVITE }));
    expect(get(acceptingSquadInviteId)).toBeNull();
    expect(dmError).toHaveBeenCalled();
  });
});

describe('acceptChannelInSquadInvite', () => {
  beforeEach(() => {
    pendingWelcomes = [welcome('chan-1')];
    vi.mocked(invoke).mockReset().mockImplementation((command: string) => {
      if (command === 'list_pending_mls_welcomes') return Promise.resolve(pendingWelcomes);
      if (command === 'accept_mls_welcome') return Promise.resolve(true);
      return Promise.resolve(undefined);
    });
    vi.mocked(persistSquad).mockReset().mockResolvedValue(undefined as unknown as Squad);
    vi.mocked(persistSquadPatch).mockReset().mockResolvedValue(undefined as unknown as Squad);
    vi.mocked(dmError).mockReset();
    squads.set([parent]);
    acceptedChannelInviteMessageIds.set([]);
    acceptingChannelInSquadId.set(null);
  });

  afterEach(() => {
    resetInviteAcceptState();
  });

  it('accepts a channel-in-squad invite and records the message id', async () => {
    await acceptChannelInSquadInvite(dmMessage({ id: 'msg-chan' }), {
      channelGroupId: 'chan-1',
      announcementsGroupId: 'parent-1',
      channelName: 'general',
    });

    expect(invoke).toHaveBeenCalledWith('accept_mls_welcome', { welcomeEventIdHex: 'welcome-chan-1' });
    expect(get(acceptedChannelInviteMessageIds)).toContain('msg-chan');
    expect(get(acceptingChannelInSquadId)).toBeNull();
  });

  it('adds the channel to the parent after the welcome is accepted', async () => {
    await acceptChannelInSquadInvite(dmMessage({ id: 'msg-chan' }), {
      channelGroupId: 'chan-1',
      announcementsGroupId: 'parent-1',
      channelName: 'general',
    });

    handleMlsWelcomeAccepted('chan-1');

    expect(persistSquadPatch).toHaveBeenCalledWith('parent-1', expect.any(Function));
    const patch = vi.mocked(persistSquadPatch).mock.calls[0]![1] as (s: Squad) => Squad;
    const patched = patch(parent);
    expect(patched.channels).toHaveLength(2);
    expect(patched.channels[1]).toEqual({ name: 'general', groupId: 'chan-1', order: 1 });
  });

  it('logs and returns when there is no matching welcome', async () => {
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'list_pending_mls_welcomes') return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    await acceptChannelInSquadInvite(dmMessage({ id: 'msg-chan' }), {
      channelGroupId: 'chan-1',
      announcementsGroupId: 'parent-1',
      channelName: 'general',
    });

    expect(invoke).not.toHaveBeenCalledWith('accept_mls_welcome', expect.any(Object));
    expect(dmError).toHaveBeenCalled();
    expect(get(acceptedChannelInviteMessageIds)).not.toContain('msg-chan');
  });

  it('clears pending state when accepting a channel invite fails', async () => {
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'list_pending_mls_welcomes') return Promise.resolve([welcome('chan-1')]);
      if (command === 'accept_mls_welcome') return Promise.reject(new Error('network'));
      return Promise.resolve(undefined);
    });

    await acceptChannelInSquadInvite(dmMessage({ id: 'msg-chan' }), {
      channelGroupId: 'chan-1',
      announcementsGroupId: 'parent-1',
      channelName: 'general',
    });

    expect(get(acceptingChannelInSquadId)).toBeNull();
    expect(dmError).toHaveBeenCalled();
    expect(get(acceptedChannelInviteMessageIds)).not.toContain('msg-chan');
    squads.set([]);
    handleMlsWelcomeAccepted('chan-1');
    expect(persistSquadPatch).not.toHaveBeenCalled();
  });
});

describe('handleMlsWelcomeAccepted', () => {
  beforeEach(() => {
    pendingWelcomes = [welcome('g1'), welcome('chan-1')];
    vi.mocked(invoke).mockReset().mockImplementation((command: string) => {
      if (command === 'list_pending_mls_welcomes') return Promise.resolve(pendingWelcomes);
      if (command === 'accept_mls_welcome') return Promise.resolve(true);
      return Promise.resolve(undefined);
    });
    vi.mocked(persistSquad).mockReset().mockResolvedValue(undefined as unknown as Squad);
    vi.mocked(persistSquadPatch).mockReset().mockResolvedValue(undefined as unknown as Squad);
    vi.mocked(dmError).mockReset();
    squads.set([]);
    acceptedChannelInviteMessageIds.set([]);
    acceptingChannelInSquadId.set(null);
    resetInviteAcceptState();
  });

  afterEach(() => {
    resetInviteAcceptState();
  });

  it('ignores unattributed squad welcomes from a regular invite accept', async () => {
    await acceptAnnouncementsInvite({ groupId: 'g1', name: 'Alpha' }, 'msg-1');
    const callsBefore = vi.mocked(persistSquadPatch).mock.calls.length;

    handleMlsWelcomeAccepted('g1');

    expect(vi.mocked(persistSquadPatch).mock.calls.length).toBe(callsBefore);
  });

  it('adds a placeholder channel when exactly one single-channel squad exists', () => {
    squads.set([
      {
        id: 'single-1',
        name: 'Single',
        channels: [{ name: 'announcements', groupId: 'single-1', order: 0 }],
        kind: 'squad',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    handleMlsWelcomeAccepted('new-group-1');

    expect(persistSquadPatch).toHaveBeenCalledWith('single-1', expect.any(Function));
    const patch = vi.mocked(persistSquadPatch).mock.calls[0]![1] as (s: Squad) => Squad;
    const patched = patch(get(squads)[0]!);
    expect(patched.channels).toHaveLength(2);
    expect(patched.channels[1].groupId).toBe('new-group-1');
  });

  it('does nothing when multiple single-channel squads exist', () => {
    squads.set([
      {
        id: 'single-1',
        name: 'Single',
        channels: [{ name: 'announcements', groupId: 'single-1', order: 0 }],
        kind: 'squad',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'single-2',
        name: 'Other',
        channels: [{ name: 'announcements', groupId: 'single-2', order: 0 }],
        kind: 'squad',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    handleMlsWelcomeAccepted('new-group-1');

    expect(persistSquadPatch).not.toHaveBeenCalled();
  });
});

describe('accept-invite channel persistence', () => {
  beforeEach(() => {
    vi.mocked(persistSquadPatch).mockReset().mockResolvedValue(undefined as unknown as Squad);
    squads.set([parent]);
  });

  it('handleChannelAddedToSquad persists merged channels', () => {
    handleChannelAddedToSquad('parent-1', 'chan-new', 'general');
    expect(persistSquadPatch).toHaveBeenCalledWith('parent-1', expect.any(Function));
    const patch = vi.mocked(persistSquadPatch).mock.calls[0]![1] as (s: Squad) => Squad;
    const patched = patch(parent);
    expect(patched.channels).toHaveLength(2);
    expect(patched.channels[1]).toEqual({
      name: 'general',
      groupId: 'chan-new',
      order: 1,
    });
  });

  it('skips duplicate channel group ids', () => {
    squads.set([
      {
        ...parent,
        channels: [...parent.channels, { name: 'general', groupId: 'chan-new', order: 1 }],
      },
    ]);
    handleChannelAddedToSquad('parent-1', 'chan-new', 'general');
    const patch = vi.mocked(persistSquadPatch).mock.calls[0]![1] as (s: Squad) => Squad;
    const patched = patch(get(squads)[0]!);
    expect(patched.channels).toHaveLength(2);
  });

  it('detects squad invite resolved when squad is already local', () => {
    expect(squadInviteResolvedByMembership('parent-1')).toBe(true);
    expect(squadInviteResolvedByMembership('missing')).toBe(false);
  });

  it('reconcileStaleInviteDecisions marks inbox invites for joined squads', () => {
    acceptedSquadInviteIds.set([]);
    pactoAppInboxMessages.set([
      {
        id: 'invite-msg-1',
        content: JSON.stringify({
          type: 'squad_invite',
          squadName: 'Alpha',
          groupId: 'parent-1',
        }),
        at: 1,
        mine: false,
        inviterNpub: 'npub1inviter',
      },
    ]);
    reconcileStaleInviteDecisions();
    expect(get(acceptedSquadInviteIds)).toEqual(['invite-msg-1']);
  });
});
