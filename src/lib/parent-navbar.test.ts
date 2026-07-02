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
} from './parent-navbar';
import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  PERSONAL_ALERTS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
} from '../stores/app';

describe('partitionHubSidebarChannels', () => {
  it('splits built-in hub rows from user-created channels', () => {
    const channels = [
      { name: 'dashboard', groupId: '__dashboard__', order: -1 },
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: PERSONAL_ALERTS_CHANNEL_NAME, groupId: 'g', order: 1 },
      { name: POLLS_CHANNEL_NAME, groupId: 'g', order: 2 },
      { name: 'c1', groupId: 'c1g', order: 3 },
    ];
    const { defaultHubChannels, customChannels } = partitionHubSidebarChannels(channels);
    expect(defaultHubChannels.map((c) => c.name)).toEqual([
      'dashboard',
      ANNOUNCEMENTS_CHANNEL_NAME,
      PERSONAL_ALERTS_CHANNEL_NAME,
      POLLS_CHANNEL_NAME,
    ]);
    expect(customChannels.map((c) => c.name)).toEqual(['c1']);
  });
});

describe('defaultChannelRowsForGroupId', () => {
  it('returns announcements, personal-alerts, and polls sharing one groupId', () => {
    const rows = defaultChannelRowsForGroupId('g-shared');
    expect(rows).toHaveLength(3);
    expect(rows.map((c) => c.groupId)).toEqual(['g-shared', 'g-shared', 'g-shared']);
    expect(rows.map((c) => c.name)).toEqual([
      ANNOUNCEMENTS_CHANNEL_NAME,
      PERSONAL_ALERTS_CHANNEL_NAME,
      POLLS_CHANNEL_NAME,
    ]);
  });
});

describe('ensureDefaultHubChannelRows', () => {
  it('backfills inbox and polls when only announcements was persisted on invite accept', () => {
    const onlyAnn = [{ name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 }];
    const fixed = ensureDefaultHubChannelRows(onlyAnn);
    expect(fixed.map((c) => c.name)).toEqual([
      ANNOUNCEMENTS_CHANNEL_NAME,
      PERSONAL_ALERTS_CHANNEL_NAME,
      POLLS_CHANNEL_NAME,
    ]);
    expect(new Set(fixed.map((c) => c.groupId))).toEqual(new Set(['g']));
  });

  it('leaves parents unchanged when all default hub rows exist', () => {
    const full = defaultChannelRowsForGroupId('g');
    expect(ensureDefaultHubChannelRows(full)).toEqual(full);
  });

  it('does not backfill when default rows use distinct MLS group ids', () => {
    const split = [
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'a', order: 0 },
      { name: PERSONAL_ALERTS_CHANNEL_NAME, groupId: 'b', order: 1 },
    ];
    expect(ensureDefaultHubChannelRows(split)).toEqual(split);
  });

  it('preserves custom channels after backfill', () => {
    const partial = [
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: 'general', groupId: 'other', order: 1 },
    ];
    const fixed = ensureDefaultHubChannelRows(partial);
    expect(fixed.map((c) => c.name)).toEqual([
      ANNOUNCEMENTS_CHANNEL_NAME,
      PERSONAL_ALERTS_CHANNEL_NAME,
      POLLS_CHANNEL_NAME,
      'general',
    ]);
    expect(fixed.find((c) => c.name === 'general')?.groupId).toBe('other');
  });
});

describe('createDefaultParentChannels', () => {
  it('creates one MLS group and three channels sharing groupId', async () => {
    const res = await createDefaultParentChannels(['npub1test']);
    expect(createGroupChat).toHaveBeenCalledTimes(1);
    expect(createGroupChat).toHaveBeenCalledWith(ANNOUNCEMENTS_CHANNEL_NAME, ['npub1test']);
    expect(res.parentId).toBe('mls-single');
    expect(res.channels).toHaveLength(3);
    expect(new Set(res.channels.map((c) => c.groupId))).toEqual(new Set(['mls-single']));
    expect(res.channels.map((c) => c.name)).toEqual([
      ANNOUNCEMENTS_CHANNEL_NAME,
      PERSONAL_ALERTS_CHANNEL_NAME,
      POLLS_CHANNEL_NAME,
    ]);
    expect(res.channels.map((c) => c.order)).toEqual([0, 1, 2]);
  });
});

describe('resolvePollsMlsGroupId', () => {
  it('returns shared MLS id when announcements and polls use the same group', () => {
    const parent = {
      channels: [
        { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
        { name: PERSONAL_ALERTS_CHANNEL_NAME, groupId: 'g', order: 1 },
        { name: POLLS_CHANNEL_NAME, groupId: 'g', order: 2 },
      ],
    };
    expect(resolvePollsMlsGroupId(parent)).toBe('g');
  });

  it('uses announcements MLS scope even when #polls row has a different groupId', () => {
    const parent = {
      channels: [
        { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'ann', order: 0 },
        { name: PERSONAL_ALERTS_CHANNEL_NAME, groupId: 'mon', order: 1 },
        { name: POLLS_CHANNEL_NAME, groupId: 'poll', order: 2 },
      ],
    };
    expect(resolvePollsMlsGroupId(parent)).toBe('ann');
  });

  it('falls back to announcements when polls channel row is missing', () => {
    const parent = {
      channels: [{ name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'only', order: 0 }],
    };
    expect(resolvePollsMlsGroupId(parent)).toBe('only');
  });
});

describe('uniqueChannelsByGroupIdPreservingOrder', () => {
  it('dedupes by groupId and skips creating placeholders', () => {
    const a = { name: 'announcements', groupId: 'g', order: 0 };
    const b = { name: 'personal-alerts', groupId: 'g', order: 1 };
    expect(uniqueChannelsByGroupIdPreservingOrder([a, b])).toEqual([a]);
    expect(uniqueChannelsByGroupIdPreservingOrder([{ ...a, groupId: 'creating-x' }])).toEqual([]);
  });
});

describe('defaultParentInvitePhysicalGroupTargets', () => {
  it('returns one MLS target when the default trio shares groupId', () => {
    const ann = { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 };
    const inbox = { name: PERSONAL_ALERTS_CHANNEL_NAME, groupId: 'g', order: 1 };
    const pol = { name: POLLS_CHANNEL_NAME, groupId: 'g', order: 2 };
    expect(defaultParentInvitePhysicalGroupTargets({ channels: [ann, inbox, pol] })).toEqual([ann]);
  });

  it('returns one MLS target per distinct default groupId when rows diverge', () => {
    const channels = [
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'a', order: 0 },
      { name: PERSONAL_ALERTS_CHANNEL_NAME, groupId: 'm', order: 1 },
      { name: POLLS_CHANNEL_NAME, groupId: 'p', order: 2 },
    ];
    expect(defaultParentInvitePhysicalGroupTargets({ channels }).map((c) => c.groupId)).toEqual(['a', 'm', 'p']);
  });

  it('falls back to the announcements row when only defaults partial', () => {
    const only = { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'solo', order: 0 };
    expect(defaultParentInvitePhysicalGroupTargets({ channels: [only] })).toEqual([only]);
  });
});
