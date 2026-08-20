import { describe, expect, it, vi } from 'vitest';

vi.mock('./api/nostr', () => ({
  createGroupChat: vi.fn().mockResolvedValue('mls-single'),
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
  MY_DASHBOARD_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
  SQUAD_DASHBOARD_CHANNEL_NAME,
  SQUAD_WARGAME_CHANNEL_ID,
  SQUAD_WARGAME_CHANNEL_NAME,
} from '../stores/app';

describe('partitionHubSidebarChannels', () => {
  it('splits built-in hub rows from user-created channels', () => {
    const channels = [
      { name: SQUAD_DASHBOARD_CHANNEL_NAME, groupId: '__squad_dashboard__', order: -2 },
      { name: MY_DASHBOARD_CHANNEL_NAME, groupId: '__my_dashboard__', order: -1 },
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: POLLS_CHANNEL_NAME, groupId: 'g', order: 1 },
      { name: 'c1', groupId: 'c1g', order: 2 },
    ];
    const { defaultHubChannels, customChannels } = partitionHubSidebarChannels(channels);
    expect(defaultHubChannels.map((c) => c.name)).toEqual([
      SQUAD_DASHBOARD_CHANNEL_NAME,
      MY_DASHBOARD_CHANNEL_NAME,
      ANNOUNCEMENTS_CHANNEL_NAME,
      POLLS_CHANNEL_NAME,
    ]);
    expect(customChannels.map((c) => c.name)).toEqual(['c1']);
  });

  it('treats squad-wargame as a built-in hub row', () => {
    const { defaultHubChannels, customChannels } = partitionHubSidebarChannels([
      { name: SQUAD_WARGAME_CHANNEL_NAME, groupId: SQUAD_WARGAME_CHANNEL_ID, order: -2 },
      { name: 'ops', groupId: 'g-ops', order: 2 },
    ]);
    expect(defaultHubChannels.map((c) => c.name)).toEqual([SQUAD_WARGAME_CHANNEL_NAME]);
    expect(customChannels.map((c) => c.name)).toEqual(['ops']);
  });
});

describe('buildHubSidebarChannels', () => {
  it('pins dashboards then announcements and polls; strips obsolete rows', () => {
    const raw = [
      ...defaultChannelRowsForGroupId('g'),
      { name: 'personal-alerts', groupId: 'g', order: 9 },
      { name: 'c1', groupId: 'c1g', order: 10 },
    ];
    const built = buildHubSidebarChannels(raw);
    expect(built.map((c) => c.name)).toEqual([
      SQUAD_DASHBOARD_CHANNEL_NAME,
      MY_DASHBOARD_CHANNEL_NAME,
      ANNOUNCEMENTS_CHANNEL_NAME,
      POLLS_CHANNEL_NAME,
      'c1',
    ]);
  });

  it('omits squad-wargame unless includeWarGame', () => {
    const built = buildHubSidebarChannels(defaultChannelRowsForGroupId('g'));
    expect(built.map((c) => c.name)).not.toContain(SQUAD_WARGAME_CHANNEL_NAME);
  });

  it('pins squad-wargame immediately after squad-dashboard when includeWarGame', () => {
    const built = buildHubSidebarChannels(defaultChannelRowsForGroupId('g'), { includeWarGame: true });
    expect(built.map((c) => c.name)).toEqual([
      SQUAD_DASHBOARD_CHANNEL_NAME,
      SQUAD_WARGAME_CHANNEL_NAME,
      MY_DASHBOARD_CHANNEL_NAME,
      ANNOUNCEMENTS_CHANNEL_NAME,
      POLLS_CHANNEL_NAME,
    ]);
    expect(built[1]).toMatchObject({
      name: SQUAD_WARGAME_CHANNEL_NAME,
      groupId: SQUAD_WARGAME_CHANNEL_ID,
    });
  });
});

describe('defaultChannelRowsForGroupId', () => {
  it('returns announcements and polls sharing one groupId', () => {
    const rows = defaultChannelRowsForGroupId('g-shared');
    expect(rows).toHaveLength(2);
    expect(rows.map((c) => c.groupId)).toEqual(['g-shared', 'g-shared']);
    expect(rows.map((c) => c.name)).toEqual([ANNOUNCEMENTS_CHANNEL_NAME, POLLS_CHANNEL_NAME]);
  });
});

describe('ensureDefaultHubChannelRows', () => {
  it('backfills polls when only announcements was persisted', () => {
    const onlyAnn = [{ name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 }];
    const fixed = ensureDefaultHubChannelRows(onlyAnn);
    expect(fixed.map((c) => c.name)).toEqual([ANNOUNCEMENTS_CHANNEL_NAME, POLLS_CHANNEL_NAME]);
    expect(new Set(fixed.map((c) => c.groupId))).toEqual(new Set(['g']));
  });

  it('strips obsolete personal-alerts rows', () => {
    const withObsolete = [
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: 'personal-alerts', groupId: 'g', order: 1 },
      { name: POLLS_CHANNEL_NAME, groupId: 'g', order: 2 },
    ];
    const fixed = ensureDefaultHubChannelRows(withObsolete);
    expect(fixed.map((c) => c.name)).toEqual([ANNOUNCEMENTS_CHANNEL_NAME, POLLS_CHANNEL_NAME]);
  });

  it('leaves parents unchanged when all default hub rows exist', () => {
    const full = defaultChannelRowsForGroupId('g');
    expect(ensureDefaultHubChannelRows(full)).toEqual(full);
  });

  it('does not rewrite when announcements and polls use distinct MLS group ids', () => {
    const split = [
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'a', order: 0 },
      { name: POLLS_CHANNEL_NAME, groupId: 'b', order: 1 },
    ];
    expect(ensureDefaultHubChannelRows(split)).toEqual(split);
  });
});

describe('createDefaultParentChannels', () => {
  it('creates one MLS group and returns announcements + polls rows', async () => {
    const out = await createDefaultParentChannels(['npub1']);
    expect(createGroupChat).toHaveBeenCalledWith(ANNOUNCEMENTS_CHANNEL_NAME, ['npub1']);
    expect(out.parentId).toBe('mls-single');
    expect(out.channels.map((c) => c.name)).toEqual([
      ANNOUNCEMENTS_CHANNEL_NAME,
      POLLS_CHANNEL_NAME,
    ]);
  });
});

describe('uniqueChannelsByGroupIdPreservingOrder', () => {
  it('keeps first channel per group id', () => {
    const channels = [
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: POLLS_CHANNEL_NAME, groupId: 'g', order: 1 },
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
      })
    ).toBe('ann-g');
  });
});

describe('defaultParentInvitePhysicalGroupTargets', () => {
  it('dedupes shared group id', () => {
    const parent = { channels: defaultChannelRowsForGroupId('g') };
    expect(defaultParentInvitePhysicalGroupTargets(parent).map((c) => c.groupId)).toEqual(['g']);
  });
});
