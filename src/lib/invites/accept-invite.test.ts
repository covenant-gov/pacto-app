import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const persistSquadPatchMock = vi.fn();
const persistSquadMock = vi.fn();

vi.mock('../squad/squad-catalog', () => ({
  persistSquadPatch: (...args: unknown[]) => persistSquadPatchMock(...args),
  persistSquad: (...args: unknown[]) => persistSquadMock(...args),
}));

vi.mock('../api/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/nostr')>();
  return {
    ...actual,
    listPendingMlsWelcomes: vi.fn(),
    acceptMlsWelcome: vi.fn(),
    syncMlsGroupsNow: vi.fn(),
  };
});

vi.mock('../../stores/backup-verification', () => ({
  requireBackupVerified: () => true,
}));

vi.mock('../utils/dm-debug', () => ({
  dmError: vi.fn(),
}));

vi.mock('../squad/squad-state-sync', () => ({
  maybeAutoRequestSquadStateSyncAfterJoin: vi.fn(),
}));

vi.mock('../squad/squad-outbound-invite', () => ({
  publishInviteAcceptedClaims: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../stores/auth', async () => {
  const { writable } = await import('svelte/store');
  return { currentUser: writable({ npub: 'npub1invitee' }) };
});

const resolveOneCatchUpEntryMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../stores/catch-up', () => ({
  resolveOneCatchUpEntry: (...args: unknown[]) => resolveOneCatchUpEntryMock(...args),
  hydrateCatchUpCount: vi.fn(),
}));

import {
  handleChannelAddedToSquad,
  handleMlsWelcomeAccepted,
  reconcileStaleInviteDecisions,
  squadInviteResolvedByMembership,
  waitForAnnouncementsWelcome,
  notifyPendingInviteWelcome,
  resetInviteAcceptState,
  acceptAnnouncementsInvite,
  acceptChannelInSquadInvite,
  ACCEPT_WELCOME_FAST_PATH_MS,
} from './accept-invite';
import { listPendingMlsWelcomes, acceptMlsWelcome, syncMlsGroupsNow } from '../api/nostr';
import { publishInviteAcceptedClaims } from '../squad/squad-outbound-invite';
import { squads, type Squad } from '../../stores/squads';
import { acceptedSquadInviteIds, acceptedChannelInviteMessageIds } from '../../stores/invite-decisions';
import { pendingSquadAdmissions, resetPendingSquadAdmissions } from '../../stores/pending-squad-admission';
import { backendDmMessages } from '../../stores/dm';
import { squadNavOrder } from '../../stores/navigation';
import {
  resetMlsHistoryWelcomeForTests,
  shouldShowMlsHistoryWelcome,
} from '../../stores/mls-history-welcome';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import type { DmMessage } from '../../stores/dm';

const parent: Squad = {
  id: 'parent-1',
  name: 'Alpha',
  channels: [{ name: 'announcements', groupId: 'parent-1', order: 0 }],
  kind: 'squad',
  createdAt: 1,
  updatedAt: 1,
};

const pendingWelcome = {
  id: 'welcome-1',
  wrapper_event_id: 'ev1',
  nostr_group_id: 'new-squad',
  group_name: 'Joined',
  group_description: null,
  group_admin_pubkeys: [] as string[],
  group_relays: [] as string[],
  welcomer: 'npub1x',
  member_count: 1,
};

describe('accept-invite channel persistence', () => {
  beforeEach(() => {
    resetInviteAcceptState();
    resetPendingSquadAdmissions();
    resetMlsHistoryWelcomeForTests();
    setCurrentNpubForPersistence('npub1test');
    resolveOneCatchUpEntryMock.mockClear();
    persistSquadPatchMock.mockReset().mockResolvedValue(parent);
    persistSquadMock.mockReset().mockImplementation(async (squad: Squad) => squad);
    vi.mocked(listPendingMlsWelcomes).mockReset().mockResolvedValue([pendingWelcome]);
    vi.mocked(acceptMlsWelcome).mockReset().mockResolvedValue(true);
    vi.mocked(syncMlsGroupsNow).mockReset().mockResolvedValue({ synced: 0, total: 0 });
    vi.mocked(publishInviteAcceptedClaims).mockReset().mockResolvedValue(undefined);
    squads.set([parent]);
    squadNavOrder.set(['parent-1']);
  });

  afterEach(() => {
    resetInviteAcceptState();
    resetPendingSquadAdmissions();
    resetMlsHistoryWelcomeForTests();
    setCurrentNpubForPersistence(null);
  });

  it('handleChannelAddedToSquad persists merged channels', () => {
    handleChannelAddedToSquad('parent-1', 'chan-new', 'general');
    expect(persistSquadPatchMock).toHaveBeenCalledWith('parent-1', expect.any(Function));
    const patch = persistSquadPatchMock.mock.calls[0]![1] as (s: Squad) => Squad;
    const patched = patch(parent);
    expect(patched.channels).toHaveLength(2);
    expect(patched.channels[1]).toEqual({
      name: 'general',
      groupId: 'chan-new',
      order: 1,
    });
    expect(shouldShowMlsHistoryWelcome('chan-new')).toBe(true);
  });

  it('skips duplicate channel group ids', () => {
    squads.set([
      {
        ...parent,
        channels: [
          ...parent.channels,
          { name: 'general', groupId: 'chan-new', order: 1 },
        ],
      },
    ]);
    handleChannelAddedToSquad('parent-1', 'chan-new', 'general');
    const patch = persistSquadPatchMock.mock.calls[0]![1] as (s: Squad) => Squad;
    const patched = patch(get(squads)[0]!);
    expect(patched.channels).toHaveLength(2);
  });

  it('does not attach unattributed welcome to a single-channel squad', () => {
    // A squad with exactly one channel (announcements) and no pending invite.
    squads.set([parent]);
    handleMlsWelcomeAccepted('unrelated-welcome');
    expect(persistSquadPatchMock).not.toHaveBeenCalled();
    expect(get(squads)[0]!.channels).toHaveLength(1);
  });

  it('detects squad invite resolved when squad is already local', () => {
    expect(squadInviteResolvedByMembership('parent-1')).toBe(true);
    expect(squadInviteResolvedByMembership('missing')).toBe(false);
  });

  it('reconcileStaleInviteDecisions marks stale DM invites for joined squads', () => {
    acceptedSquadInviteIds.set([]);
    backendDmMessages.set({
      npub1inviter: [
        {
          id: 'invite-msg-1',
          content: JSON.stringify({
            type: 'squad_invite',
            squadName: 'Alpha',
            groupId: 'parent-1',
          }),
          at: 1,
          mine: false,
        },
      ],
    });
    reconcileStaleInviteDecisions();
    expect(get(acceptedSquadInviteIds)).toEqual(['invite-msg-1']);
  });

  it('acceptAnnouncementsInvite appends the new squad id to nav order', async () => {
    await acceptAnnouncementsInvite({ groupId: 'new-squad', name: 'Joined' }, 'msg-join');
    expect(persistSquadMock).toHaveBeenCalled();
    expect(get(squadNavOrder)).toEqual(['parent-1', 'new-squad']);
    expect(get(squads).some((s) => s.id === 'new-squad')).toBe(true);
    expect(shouldShowMlsHistoryWelcome('new-squad')).toBe(true);
  });

  it('finalize does not await post-accept syncMlsGroupsNow', async () => {
    let call = 0;
    let resolveHang: (() => void) | undefined;
    vi.mocked(syncMlsGroupsNow).mockImplementation(() => {
      call += 1;
      if (call === 1) {
        // Initial one-group probe before accept.
        return Promise.resolve({ synced: 0, total: 0 });
      }
      // Post-finalize sync must be fire-and-forget.
      return new Promise((resolve) => {
        resolveHang = () => resolve({ synced: 0, total: 0 });
      });
    });
    await acceptAnnouncementsInvite({ groupId: 'new-squad', name: 'Joined' }, 'msg-join');
    expect(get(squads).some((s) => s.id === 'new-squad')).toBe(true);
    expect(call).toBeGreaterThanOrEqual(2);
    resolveHang?.();
  });

  it('waitForAnnouncementsWelcome lists only and wakes on notify', async () => {
    vi.mocked(listPendingMlsWelcomes)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([pendingWelcome]);
    const waited = waitForAnnouncementsWelcome('new-squad', 10_000);
    await vi.waitFor(() => expect(listPendingMlsWelcomes).toHaveBeenCalled());
    expect(syncMlsGroupsNow).not.toHaveBeenCalled();
    notifyPendingInviteWelcome('new-squad');
    await expect(waited).resolves.toMatchObject({ id: 'welcome-1', nostr_group_id: 'new-squad' });
    expect(vi.mocked(syncMlsGroupsNow).mock.calls.some((c) => c[0] === null)).toBe(false);
  });

  it('consent-first Accept persists joining state without hard fail when no welcome', async () => {
    vi.useFakeTimers();
    vi.mocked(listPendingMlsWelcomes).mockResolvedValue([]);
    const done = acceptAnnouncementsInvite(
      { groupId: 'pending-squad', name: 'Pending' },
      'msg-pending',
      { inviteId: 'inv-9', admitterNpubs: ['npub1admitter'], invitedByNpub: 'npub1admitter' }
    );
    await vi.advanceTimersByTimeAsync(ACCEPT_WELCOME_FAST_PATH_MS + 50);
    await done;
    expect(publishInviteAcceptedClaims).toHaveBeenCalled();
    expect(get(pendingSquadAdmissions).some((p) => p.groupId === 'pending-squad')).toBe(true);
    expect(get(squads).some((s) => s.id === 'pending-squad')).toBe(false);
    vi.useRealTimers();
  });

  it('acceptChannelInSquadInvite resolves catch-up when already a member', async () => {
    squads.set([
      {
        ...parent,
        channels: [
          ...parent.channels,
          { name: 'general', groupId: 'chan-1', order: 1 },
        ],
      },
    ]);
    const msg = { id: 'chan-invite-1', content: '', at: 1, mine: false } as DmMessage;
    await acceptChannelInSquadInvite(msg, {
      channelGroupId: 'chan-1',
      announcementsGroupId: 'parent-1',
      channelName: 'general',
    });
    expect(resolveOneCatchUpEntryMock).toHaveBeenCalledWith('chan-invite-1');
    expect(get(acceptedChannelInviteMessageIds)).toContain('chan-invite-1');
  });
});
