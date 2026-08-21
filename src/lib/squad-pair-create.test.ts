import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('./parent-navbar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./parent-navbar')>();
  return {
    ...actual,
    createDefaultParentChannels: vi.fn(),
  };
});

vi.mock('./utils/tauri-errors', () => ({
  getInvokeErrorMessage: vi.fn((e: unknown, fallback?: string) =>
    e instanceof Error ? e.message : (fallback ?? String(e))
  ),
  friendlyMessage: vi.fn((msg: string) => msg),
}));

vi.mock('./pacto-app-inbox', () => ({
  sendSquadInviteDm: vi.fn(),
}));

vi.mock('./squad-hub-nav', () => ({
  activateSquadHub: vi.fn(),
}));

vi.mock('./commons/squad-create-broadcast', () => ({
  schedulePublicSquadCreateBroadcast: vi.fn(),
}));

vi.mock('./squad/squad-catalog', () => ({
  persistCreatedSquad: vi.fn(async (_tempId: string, squad: unknown) => squad),
}));

vi.mock('./squad/squad-bot', () => ({
  initSquadBot: vi.fn(),
}));

vi.mock('./squad/skipped-members', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./squad/skipped-members')>();
  return {
    ...actual,
    warnSkippedMembers: vi.fn(actual.warnSkippedMembers),
    warnPendingInvites: vi.fn(actual.warnPendingInvites),
  };
});

vi.mock('../stores/profiles', () => ({
  profiles: createMockWritable<Record<string, { nickname?: string }>>({}),
}));

vi.mock('./squad/squad-create-network', () => ({
  applySquadCreateNetwork: vi.fn(),
}));

vi.mock('../stores/squads', () => ({
  squads: createMockWritable<Squad[]>([]),
  addParentCreatingAnnouncements: vi.fn(),
  removeParentCreatingAnnouncements: vi.fn(),
  parentCreateErrorById: createMockWritable<Record<string, string>>({}),
  parentPendingCreateMembers: createMockWritable<Record<string, string[]>>({}),
  parentPendingCreateOptions: createMockWritable<Record<string, { network?: string }>>({}),
  parentRetryingCreateIds: createMockWritable<Set<string>>(new Set()),
  ANNOUNCEMENTS_CHANNEL_NAME: 'announcements',
}));

vi.mock('../stores/navigation', () => ({
  activeSquadId: createMockWritable<string | null>(null),
  activeChannelId: createMockWritable<string | null>(null),
  activeHubChannelName: createMockWritable<string | null>(null),
  activeView: createMockWritable<'hub' | 'profile'>('hub'),
  activeTopNavTab: createMockWritable<string>('squads'),
  lastChannelBySquadId: createMockWritable<Record<string, string>>({}),
  lastHubChannelNameBySquadId: createMockWritable<Record<string, string>>({}),
  squadNavOrder: createMockWritable<string[]>([]),
}));

vi.mock('../stores/auth', () => ({
  currentUser: createMockWritable<{ npub: string; pubkey: string } | null>(null),
}));

vi.mock('../stores/toast', () => ({
  pendingReadyToast: createMockWritable<{ text: string; goTo?: { id: string } } | null>(null),
  showToast: vi.fn(),
}));

import {
  buildPairedSquads,
  collectInviteNpubsForSquads,
  pairPartnerExcludeSquadIds,
  resolvePairAnchorFromHub,
  partnerSquadCandidates,
  runSquadPairCreateFlow,
  retryParentAnnouncementsCreate,
} from './squad-pair-create';
import type { Squad } from '../stores/squads';
import { createDefaultParentChannels, type DefaultParentChannelsCreated } from './parent-navbar';
import { sendSquadInviteDm } from './pacto-app-inbox';
import { persistCreatedSquad } from './squad/squad-catalog';
import {
  warnSkippedMembers,
  skippedMembersNotice,
  warnPendingInvites,
  pendingInvitesNotice,
} from './squad/skipped-members';
import { shortNpub } from './squad/squad-bot-announce';
import {
  squads,
  parentCreateErrorById,
  parentPendingCreateMembers,
  parentPendingCreateOptions,
  parentRetryingCreateIds,
} from '../stores/squads';
import { currentUser } from '../stores/auth';
import { pendingReadyToast, showToast } from '../stores/toast';
import { applySquadCreateNetwork } from './squad/squad-create-network';
import { profiles } from '../stores/profiles';

function createMockWritable<T>(initial: T) {
  let value = initial;
  const subscribers = new Set<(v: T) => void>();
  return {
    set: (v: T) => {
      value = v;
      subscribers.forEach((fn) => fn(v));
    },
    update: (fn: (v: T) => T) => {
      value = fn(value);
      subscribers.forEach((sub) => sub(value));
    },
    subscribe: (fn: (v: T) => void) => {
      fn(value);
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

const anchor: Squad = {
  id: 'anchor',
  name: 'Squad A',
  channels: [{ name: 'announcements', groupId: 'g-a', order: 0 }],
  kind: 'squad',
  createdAt: 1,
  updatedAt: 1,
};

const partner: Squad = {
  id: 'partner',
  name: 'Squad B',
  channels: [{ name: 'announcements', groupId: 'g-b', order: 0 }],
  kind: 'squad',
  createdAt: 2,
  updatedAt: 2,
};

const existingPair: Squad = {
  id: 'pair',
  name: 'Pair',
  channels: [{ name: 'announcements', groupId: 'g-p', order: 0 }],
  kind: 'squad-pair',
  pairedSquads: [
    { id: 'anchor', name: 'Squad A' },
    { id: 'partner', name: 'Squad B' },
  ],
  createdAt: 3,
  updatedAt: 3,
};

describe('resolvePairAnchorFromHub', () => {
  it('returns the hub when it is a regular squad', () => {
    expect(resolvePairAnchorFromHub(anchor, [anchor, partner])).toEqual(anchor);
  });

  it('returns the first anchor squad when the hub is a squad-pair', () => {
    expect(resolvePairAnchorFromHub(existingPair, [anchor, partner, existingPair])).toEqual(anchor);
  });
});

describe('pairPartnerExcludeSquadIds', () => {
  it('excludes sibling anchors when pairing from a squad-pair hub', () => {
    expect(pairPartnerExcludeSquadIds(existingPair, anchor)).toEqual(['partner']);
  });

  it('returns empty when pairing from a regular squad', () => {
    expect(pairPartnerExcludeSquadIds(anchor, anchor)).toEqual([]);
  });
});

describe('partnerSquadCandidates', () => {
  it('excludes anchor, squad-pairs, and squads without channels', () => {
    const empty: Squad = {
      ...partner,
      id: 'empty',
      name: 'Empty',
      channels: [],
    };
    const list = partnerSquadCandidates([anchor, partner, existingPair, empty], anchor.id);
    expect(list.map((s) => s.id)).toEqual(['partner']);
  });
});

describe('buildPairedSquads', () => {
  it('returns anchor and partner refs', () => {
    expect(buildPairedSquads(anchor, partner)).toEqual([
      { id: 'anchor', name: 'Squad A' },
      { id: 'partner', name: 'Squad B' },
    ]);
  });
});

describe('collectInviteNpubsForSquads', () => {
  it('unions members from both squads and excludes self', async () => {
    const fetchMembers = vi.fn(async (gid: string) => {
      if (gid === 'g-a') return { members: ['me', 'alice'] };
      if (gid === 'g-b') return { members: ['me', 'bob', 'alice'] };
      return { members: [] };
    });
    const npubs = await collectInviteNpubsForSquads([anchor, partner], 'me', fetchMembers);
    expect(npubs.sort()).toEqual(['alice', 'bob']);
  });
});

describe('runSquadPairCreateFlow', () => {
  beforeEach(() => {
    squads.set([]);
    parentPendingCreateMembers.set({});
    pendingReadyToast.set(null);
    currentUser.set({ npub: 'me', pubkey: 'pk' });
    vi.mocked(createDefaultParentChannels).mockReset();
    vi.mocked(sendSquadInviteDm).mockReset().mockResolvedValue(true);
    vi.mocked(persistCreatedSquad)
      .mockReset()
      .mockImplementation(async (_tempId, squad) => squad as Squad);
    vi.mocked(warnSkippedMembers).mockClear();
    vi.mocked(warnPendingInvites).mockClear();
  });

  afterEach(() => {
    squads.set([]);
    parentPendingCreateMembers.set({});
    pendingReadyToast.set(null);
    currentUser.set(null);
  });

  it('folds the skipped-members notice into the ready toast text instead of a separate toast', async () => {
    vi.mocked(createDefaultParentChannels).mockResolvedValue({
      parentId: 'group-1',
      channels: [{ name: 'announcements', groupId: 'group-1', order: 0 }],
      skippedMembers: [{ npub: 'npub-stale', reason: 'Missing required encoding tag' }],
      pendingInvites: [],
    });

    runSquadPairCreateFlow('Pair Name', ['npub-a', 'npub-stale'], anchor, partner);

    await vi.waitFor(() => {
      expect(get(pendingReadyToast)?.goTo?.id).toBe('group-1');
    });

    const toast = get(pendingReadyToast);
    expect(toast?.text).not.toBe('Pair Name is ready!');
    expect(toast?.text).toContain('npub-stale');
    expect(warnSkippedMembers).toHaveBeenCalledWith([
      { npub: 'npub-stale', reason: 'Missing required encoding tag' },
    ]);
    expect(sendSquadInviteDm).toHaveBeenCalledWith('npub-a', expect.anything(), 'me');
    expect(sendSquadInviteDm).not.toHaveBeenCalledWith('npub-stale', expect.anything(), expect.anything());
  });

  it('keeps the plain ready-toast text when nobody is skipped', async () => {
    vi.mocked(createDefaultParentChannels).mockResolvedValue({
      parentId: 'group-2',
      channels: [{ name: 'announcements', groupId: 'group-2', order: 0 }],
      skippedMembers: [],
      pendingInvites: [],
    });

    runSquadPairCreateFlow('Pair Name', ['npub-a'], anchor, partner);

    await vi.waitFor(() => {
      expect(get(pendingReadyToast)?.goTo?.id).toBe('group-2');
    });

    expect(get(pendingReadyToast)?.text).toBe('Pair Name is ready!');
    expect(warnSkippedMembers).not.toHaveBeenCalled();
  });

  it('folds the pending-invite notice into the ready toast when nobody is skipped', async () => {
    vi.mocked(createDefaultParentChannels).mockResolvedValue({
      parentId: 'group-3',
      channels: [{ name: 'announcements', groupId: 'group-3', order: 0 }],
      skippedMembers: [],
      pendingInvites: [{ npub: 'npub-pending', reason: 'Welcome delivery failed' }],
    });

    runSquadPairCreateFlow('Pair Name', ['npub-a', 'npub-pending'], anchor, partner);

    await vi.waitFor(() => {
      expect(get(pendingReadyToast)?.goTo?.id).toBe('group-3');
    });

    const toast = get(pendingReadyToast);
    expect(toast?.text).not.toBe('Pair Name is ready!');
    expect(toast?.text).toContain('npub-pending');
    expect(warnPendingInvites).toHaveBeenCalledWith([
      { npub: 'npub-pending', reason: 'Welcome delivery failed' },
    ]);
  });

  it('excludes pending-invite npubs from the invite DM, unlike a clean member', async () => {
    vi.mocked(createDefaultParentChannels).mockResolvedValue({
      parentId: 'group-5',
      channels: [{ name: 'announcements', groupId: 'group-5', order: 0 }],
      skippedMembers: [],
      pendingInvites: [{ npub: 'npub-pending', reason: 'Welcome delivery failed' }],
    });

    runSquadPairCreateFlow('Pair Name', ['npub-a', 'npub-pending'], anchor, partner);

    await vi.waitFor(() => {
      expect(get(pendingReadyToast)?.goTo?.id).toBe('group-5');
    });

    expect(sendSquadInviteDm).toHaveBeenCalledWith('npub-a', expect.anything(), 'me');
    expect(sendSquadInviteDm).not.toHaveBeenCalledWith('npub-pending', expect.anything(), expect.anything());
  });

  it('keeps both notices when members are skipped and pending, dropping neither', async () => {
    vi.mocked(createDefaultParentChannels).mockResolvedValue({
      parentId: 'group-4',
      channels: [{ name: 'announcements', groupId: 'group-4', order: 0 }],
      skippedMembers: [{ npub: 'npub-stale', reason: 'Missing required encoding tag' }],
      pendingInvites: [{ npub: 'npub-pending', reason: 'Welcome delivery failed' }],
    });

    runSquadPairCreateFlow('Pair Name', ['npub-a', 'npub-stale', 'npub-pending'], anchor, partner);

    await vi.waitFor(() => {
      expect(get(pendingReadyToast)?.goTo?.id).toBe('group-4');
    });

    const toast = get(pendingReadyToast);
    expect(toast?.text).toContain('npub-stale');
    expect(toast?.text).toContain('npub-pending');
    expect(warnSkippedMembers).toHaveBeenCalledWith([
      { npub: 'npub-stale', reason: 'Missing required encoding tag' },
    ]);
    expect(warnPendingInvites).toHaveBeenCalledWith([
      { npub: 'npub-pending', reason: 'Welcome delivery failed' },
    ]);
  });
});

describe('runSquadPairCreateFlow failure path', () => {
  beforeEach(() => {
    squads.set([]);
    parentPendingCreateMembers.set({});
    parentCreateErrorById.set({});
    pendingReadyToast.set(null);
    currentUser.set({ npub: 'me', pubkey: 'pk' });
    vi.mocked(createDefaultParentChannels).mockReset();
    vi.mocked(showToast).mockReset();
    vi.mocked(persistCreatedSquad).mockReset();
  });

  afterEach(() => {
    squads.set([]);
    parentPendingCreateMembers.set({});
    parentCreateErrorById.set({});
    currentUser.set(null);
  });

  it('keeps the placeholder and its pending members so the create stays retryable', async () => {
    vi.mocked(createDefaultParentChannels).mockRejectedValue(new Error('relay unreachable'));

    runSquadPairCreateFlow('Pair Name', ['npub-a'], anchor, partner);
    const tempId = get(squads)[0]!.id;

    await vi.waitFor(() => {
      expect(get(parentCreateErrorById)[tempId]).toBe('relay unreachable');
    });

    expect(get(squads).map((s) => s.id)).toEqual([tempId]);
    expect(get(parentPendingCreateMembers)[tempId]).toEqual(['npub-a']);
    expect(persistCreatedSquad).not.toHaveBeenCalled();
    const [message, , action, opts] = vi.mocked(showToast).mock.calls[0]!;
    expect(message).toBe('relay unreachable');
    expect(action?.label).toBeTruthy();
    expect(opts).toEqual({ error: true });
  });
});

describe('retryParentAnnouncementsCreate', () => {
  const retryParent: Squad = {
    id: 'parent-1',
    name: 'Alpha',
    channels: [],
    kind: 'squad',
    createdAt: 1,
    updatedAt: 1,
  };

  const retriedChannels = [{ name: 'announcements', groupId: 'group-3', order: 0 }];

  beforeEach(() => {
    squads.set([retryParent]);
    parentPendingCreateMembers.set({ 'parent-1': ['npub-a', 'npub-stale'] });
    parentPendingCreateOptions.set({});
    parentRetryingCreateIds.set(new Set());
    pendingReadyToast.set(null);
    currentUser.set({ npub: 'me', pubkey: 'pk' });
    vi.mocked(createDefaultParentChannels).mockReset();
    vi.mocked(sendSquadInviteDm).mockReset().mockResolvedValue(true);
    vi.mocked(applySquadCreateNetwork).mockReset();
    vi.mocked(persistCreatedSquad)
      .mockReset()
      .mockImplementation(async (_tempId, squad) => squad as Squad);
    vi.mocked(warnSkippedMembers).mockClear();
    vi.mocked(warnPendingInvites).mockClear();
  });

  afterEach(() => {
    squads.set([]);
    parentPendingCreateMembers.set({});
    parentPendingCreateOptions.set({});
    parentRetryingCreateIds.set(new Set());
    pendingReadyToast.set(null);
    currentUser.set(null);
  });

  it('folds the skipped-members notice into the retry ready toast', async () => {
    vi.mocked(createDefaultParentChannels).mockResolvedValue({
      parentId: 'group-3',
      channels: retriedChannels,
      skippedMembers: [{ npub: 'npub-stale', reason: 'Missing required encoding tag' }],
      pendingInvites: [],
    });

    await retryParentAnnouncementsCreate(retryParent);

    const toast = get(pendingReadyToast);
    expect(toast?.text).not.toBe('Alpha is ready!');
    expect(toast?.text).toContain('npub-stale');
    expect(warnSkippedMembers).toHaveBeenCalledWith([
      { npub: 'npub-stale', reason: 'Missing required encoding tag' },
    ]);
  });

  it('folds the pending-invite notice into the retry ready toast', async () => {
    vi.mocked(createDefaultParentChannels).mockResolvedValue({
      parentId: 'group-3',
      channels: retriedChannels,
      skippedMembers: [],
      pendingInvites: [{ npub: 'npub-pending', reason: 'Welcome delivery failed' }],
    });

    await retryParentAnnouncementsCreate(retryParent);

    const toast = get(pendingReadyToast);
    expect(toast?.text).not.toBe('Alpha is ready!');
    expect(toast?.text).toContain('npub-pending');
    expect(warnPendingInvites).toHaveBeenCalledWith([
      { npub: 'npub-pending', reason: 'Welcome delivery failed' },
    ]);
  });

  it('excludes pending-invite npubs from the retry invite DM, unlike a clean member', async () => {
    parentPendingCreateMembers.set({ 'parent-1': ['npub-a', 'npub-pending'] });
    vi.mocked(createDefaultParentChannels).mockResolvedValue({
      parentId: 'group-3',
      channels: retriedChannels,
      skippedMembers: [],
      pendingInvites: [{ npub: 'npub-pending', reason: 'Welcome delivery failed' }],
    });

    await retryParentAnnouncementsCreate(retryParent);

    expect(sendSquadInviteDm).toHaveBeenCalledWith('npub-a', expect.anything(), 'me');
    expect(sendSquadInviteDm).not.toHaveBeenCalledWith('npub-pending', expect.anything(), expect.anything());
  });

  it('returns early when there is no pending member list', async () => {
    parentPendingCreateMembers.set({});
    await retryParentAnnouncementsCreate(retryParent);
    expect(createDefaultParentChannels).not.toHaveBeenCalled();
  });

  it('drops a concurrent retry for the same parent instead of creating a second group', async () => {
    const gate = Promise.withResolvers<DefaultParentChannelsCreated>();
    vi.mocked(createDefaultParentChannels).mockReturnValue(gate.promise);

    const first = retryParentAnnouncementsCreate(retryParent);
    await retryParentAnnouncementsCreate(retryParent);
    expect(createDefaultParentChannels).toHaveBeenCalledTimes(1);

    gate.resolve({ parentId: 'group-3', channels: retriedChannels, skippedMembers: [], pendingInvites: [] });
    await first;
    expect(persistCreatedSquad).toHaveBeenCalledTimes(1);
  });

  it('abandons the new group when the squad was discarded mid-retry', async () => {
    const gate = Promise.withResolvers<DefaultParentChannelsCreated>();
    vi.mocked(createDefaultParentChannels).mockReturnValue(gate.promise);

    const pending = retryParentAnnouncementsCreate(retryParent);
    parentPendingCreateMembers.set({});
    squads.set([]);
    gate.resolve({ parentId: 'group-3', channels: retriedChannels, skippedMembers: [], pendingInvites: [] });
    await pending;

    expect(persistCreatedSquad).not.toHaveBeenCalled();
    expect(sendSquadInviteDm).not.toHaveBeenCalled();
    expect(get(squads)).toEqual([]);
  });

  it('replays the network chosen at create time', async () => {
    parentPendingCreateOptions.set({ 'parent-1': { network: 'sepolia' } });
    vi.mocked(createDefaultParentChannels).mockResolvedValue({
      parentId: 'group-3',
      channels: retriedChannels,
      skippedMembers: [],
      pendingInvites: [],
    });

    await retryParentAnnouncementsCreate(retryParent);

    expect(applySquadCreateNetwork).toHaveBeenCalledWith('me', 'group-3', 'sepolia');
    expect(get(parentPendingCreateOptions)['parent-1']).toBeUndefined();
    expect(get(pendingReadyToast)?.text).toBe('Alpha is ready!');
  });

  it('keeps squad-pair invite metadata on a retried pair', async () => {
    const pairParent: Squad = {
      ...retryParent,
      kind: 'squad-pair',
      pairedSquads: [
        { id: 'anchor', name: 'Squad A' },
        { id: 'partner', name: 'Squad B' },
      ],
    };
    squads.set([pairParent]);
    vi.mocked(createDefaultParentChannels).mockResolvedValue({
      parentId: 'group-3',
      channels: retriedChannels,
      skippedMembers: [],
      pendingInvites: [],
    });

    await retryParentAnnouncementsCreate(pairParent);

    expect(sendSquadInviteDm).toHaveBeenCalledWith(
      'npub-a',
      expect.objectContaining({
        kind: 'squad-pair',
        pairedSquads: pairParent.pairedSquads,
      }),
      'me'
    );
  });
});

describe('skippedMembersNotice', () => {
  const npub = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

  afterEach(() => {
    profiles.set({});
  });

  it('is empty when nobody was skipped', () => {
    expect(skippedMembersNotice([])).toBe('');
  });

  it('falls back to a shortened npub when no profile is cached', () => {
    const notice = skippedMembersNotice([{ npub, reason: 'x' }]);
    expect(notice).toContain(shortNpub(npub));
    expect(notice).not.toContain('Unknown');
    expect(notice).not.toMatch(/add\s*\./);
  });

  it('uses the cached profile name when one is known', () => {
    profiles.set({ [npub]: { nickname: 'Ada' } as never });
    expect(skippedMembersNotice([{ npub, reason: 'x' }])).toContain('Ada');
  });
});

describe('pendingInvitesNotice', () => {
  const npub = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

  afterEach(() => {
    profiles.set({});
  });

  it('is empty when nobody is pending', () => {
    expect(pendingInvitesNotice([])).toBe('');
  });

  it('falls back to a shortened npub when no profile is cached', () => {
    const notice = pendingInvitesNotice([{ npub, reason: 'x' }]);
    expect(notice).toContain(shortNpub(npub));
    expect(notice).not.toContain('Unknown');
  });

  it('uses the cached profile name when one is known', () => {
    profiles.set({ [npub]: { nickname: 'Ada' } as never });
    expect(pendingInvitesNotice([{ npub, reason: 'x' }])).toContain('Ada');
  });
});
