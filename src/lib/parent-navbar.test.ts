import { describe, expect, it, vi } from 'vitest';

vi.mock('./api/nostr', () => ({
  createGroupChat: vi.fn().mockResolvedValue({ groupId: 'mls-single', skippedMembers: [], pendingInvites: [] }),
  getMlsGroupMembers: vi.fn(),
}));

import { createGroupChat } from './api/nostr';
import {
  createDefaultParentChannels,
  defaultChannelRowsForGroupId,
  ensureDefaultHubChannelRows,
  uniqueChannelsByGroupIdPreservingOrder,
  resolvePollsMlsGroupId,
  defaultParentInvitePhysicalGroupTargets,
  partitionHubSidebarChannels,
  buildHubSidebarChannels,
} from './parent-navbar';
import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  TOOLS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
  SETTINGS_CHANNEL_NAME,
  SQUAD_DASHBOARD_CHANNEL_ID,
  SQUAD_DASHBOARD_CHANNEL_NAME,
  SQUAD_WARGAME_CHANNEL_ID,
  SQUAD_WARGAME_CHANNEL_NAME,
} from './squad/hub-channel-names';

const DEFAULTS = [ANNOUNCEMENTS_CHANNEL_NAME, TOOLS_CHANNEL_NAME];

describe('partitionHubSidebarChannels', () => {
  it('splits built-in hub rows from user-created channels', () => {
    const channels = [
      { name: SQUAD_DASHBOARD_CHANNEL_NAME, groupId: SQUAD_DASHBOARD_CHANNEL_ID, order: -2 },
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: TOOLS_CHANNEL_NAME, groupId: 'g', order: 1 },
      { name: 'c1', groupId: 'c1g', order: 2 },
    ];
    const { defaultHubChannels, customChannels } = partitionHubSidebarChannels(channels);
    expect(defaultHubChannels.map((c) => c.name)).toEqual([
      SQUAD_DASHBOARD_CHANNEL_NAME,
      ANNOUNCEMENTS_CHANNEL_NAME,
      TOOLS_CHANNEL_NAME,
    ]);
    expect(customChannels.map((c) => c.name)).toEqual(['c1']);
  });

  it('does not treat gov-practice as a sidebar hub row', () => {
    const { defaultHubChannels, customChannels } = partitionHubSidebarChannels([
      { name: SQUAD_WARGAME_CHANNEL_NAME, groupId: SQUAD_WARGAME_CHANNEL_ID, order: -2 },
      { name: 'ops', groupId: 'g-ops', order: 2 },
    ]);
    expect(defaultHubChannels.map((c) => c.name)).toEqual([]);
    expect(customChannels.map((c) => c.name)).toEqual([SQUAD_WARGAME_CHANNEL_NAME, 'ops']);
  });
});

describe('buildHubSidebarChannels', () => {
  it('pins announcements then governance tools and settings; strips obsolete rows', () => {
    const raw = [
      ...defaultChannelRowsForGroupId('g'),
      { name: 'my-dashboard', groupId: '__my_dashboard__', order: 8 },
      { name: 'personal-alerts', groupId: 'g', order: 9 },
      { name: POLLS_CHANNEL_NAME, groupId: 'g', order: 10 },
      { name: 'c1', groupId: 'c1g', order: 11 },
    ];
    const built = buildHubSidebarChannels(raw);
    expect(built.map((c) => c.name)).toEqual([
      ANNOUNCEMENTS_CHANNEL_NAME,
      SQUAD_DASHBOARD_CHANNEL_NAME,
      TOOLS_CHANNEL_NAME,
      SETTINGS_CHANNEL_NAME,
      'c1',
    ]);
  });

  it('synthesizes announcements from tools when the announcements row is missing', () => {
    const built = buildHubSidebarChannels([
      { name: TOOLS_CHANNEL_NAME, groupId: 'g', order: 1 },
    ]);
    expect(built.map((c) => c.name)).toEqual([
      ANNOUNCEMENTS_CHANNEL_NAME,
      SQUAD_DASHBOARD_CHANNEL_NAME,
      TOOLS_CHANNEL_NAME,
      SETTINGS_CHANNEL_NAME,
    ]);
    expect(built.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.groupId).toBe('g');
  });

  it('synthesizes board from announcements when board row is missing', () => {
    const built = buildHubSidebarChannels([
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
    ]);
    expect(built.map((c) => c.name)).toEqual([
      ANNOUNCEMENTS_CHANNEL_NAME,
      SQUAD_DASHBOARD_CHANNEL_NAME,
      TOOLS_CHANNEL_NAME,
      SETTINGS_CHANNEL_NAME,
    ]);
    expect(built.find((c) => c.name === TOOLS_CHANNEL_NAME)?.groupId).toBe('g');
  });

  it('never injects a gov-practice sidebar row', () => {
    const built = buildHubSidebarChannels([
      ...defaultChannelRowsForGroupId('g'),
      { name: SQUAD_WARGAME_CHANNEL_NAME, groupId: SQUAD_WARGAME_CHANNEL_ID, order: -2 },
    ]);
    expect(built.map((c) => c.name)).not.toContain(SQUAD_WARGAME_CHANNEL_NAME);
    expect(built.map((c) => c.name)).toEqual([
      ANNOUNCEMENTS_CHANNEL_NAME,
      SQUAD_DASHBOARD_CHANNEL_NAME,
      TOOLS_CHANNEL_NAME,
      SETTINGS_CHANNEL_NAME,
    ]);
  });
});

describe('defaultChannelRowsForGroupId', () => {
  it('returns announcements and board sharing one groupId', () => {
    const rows = defaultChannelRowsForGroupId('g-shared');
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((c) => c.groupId))).toEqual(new Set(['g-shared']));
    expect(rows.map((c) => c.name)).toEqual(DEFAULTS);
  });
});

describe('ensureDefaultHubChannelRows', () => {
  it('backfills board when only announcements was persisted', () => {
    const onlyAnn = [{ name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 }];
    const fixed = ensureDefaultHubChannelRows(onlyAnn);
    expect(fixed.map((c) => c.name)).toEqual(DEFAULTS);
    expect(new Set(fixed.map((c) => c.groupId))).toEqual(new Set(['g']));
  });

  it('strips obsolete personal-alerts and legacy shelf rows', () => {
    const withObsolete = [
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: 'personal-alerts', groupId: 'g', order: 1 },
      { name: POLLS_CHANNEL_NAME, groupId: 'g', order: 2 },
    ];
    const fixed = ensureDefaultHubChannelRows(withObsolete);
    expect(fixed.map((c) => c.name)).toEqual(DEFAULTS);
  });

  it('leaves parents unchanged when all default hub rows exist', () => {
    const full = defaultChannelRowsForGroupId('g');
    expect(ensureDefaultHubChannelRows(full)).toEqual(full);
  });

  it('does not rewrite when announcements and board use distinct MLS group ids', () => {
    const split = [
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'a', order: 0 },
      { name: TOOLS_CHANNEL_NAME, groupId: 'b', order: 1 },
    ];
    expect(ensureDefaultHubChannelRows(split)).toEqual(split);
  });
});

describe('createDefaultParentChannels', () => {
  it('creates one MLS group and returns announcements + board rows', async () => {
    const out = await createDefaultParentChannels(['npub1']);
    expect(createGroupChat).toHaveBeenCalledWith(ANNOUNCEMENTS_CHANNEL_NAME, ['npub1']);
    expect(out.parentId).toBe('mls-single');
    expect(out.channels.map((c) => c.name)).toEqual([
      ANNOUNCEMENTS_CHANNEL_NAME,
      TOOLS_CHANNEL_NAME,
    ]);
    expect(out.skippedMembers).toEqual([]);
    expect(out.pendingInvites).toEqual([]);
  });

  it('passes through skipped members from createGroupChat', async () => {
    vi.mocked(createGroupChat).mockResolvedValueOnce({
      groupId: 'mls-single',
      skippedMembers: [{ npub: 'npub-stale', reason: 'Missing required encoding tag' }],
      pendingInvites: [],
    });
    const out = await createDefaultParentChannels(['npub1', 'npub-stale']);
    expect(out.skippedMembers).toEqual([{ npub: 'npub-stale', reason: 'Missing required encoding tag' }]);
  });

  it('passes through pending invites from createGroupChat', async () => {
    vi.mocked(createGroupChat).mockResolvedValueOnce({
      groupId: 'mls-single',
      skippedMembers: [],
      pendingInvites: [{ npub: 'npub-pending', reason: 'Welcome delivery failed' }],
    });
    const out = await createDefaultParentChannels(['npub1', 'npub-pending']);
    expect(out.pendingInvites).toEqual([{ npub: 'npub-pending', reason: 'Welcome delivery failed' }]);
  });
});

describe('uniqueChannelsByGroupIdPreservingOrder', () => {
  it('keeps first channel per group id', () => {
    const channels = [
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: TOOLS_CHANNEL_NAME, groupId: 'g', order: 1 },
      { name: 'c1', groupId: 'c1', order: 2 },
    ];
    expect(uniqueChannelsByGroupIdPreservingOrder(channels).map((c) => c.name)).toEqual([
      ANNOUNCEMENTS_CHANNEL_NAME,
      'c1',
    ]);
  });
});

describe('resolvePollsMlsGroupId', () => {
  it('uses announcements group id', () => {
    expect(
      resolvePollsMlsGroupId({
        channels: defaultChannelRowsForGroupId('ann-g'),
      }),
    ).toBe('ann-g');
  });
});

describe('defaultParentInvitePhysicalGroupTargets', () => {
  it('dedupes shared group id', () => {
    const parent = { channels: defaultChannelRowsForGroupId('g') };
    expect(defaultParentInvitePhysicalGroupTargets(parent).map((c) => c.groupId)).toEqual(['g']);
  });
});
