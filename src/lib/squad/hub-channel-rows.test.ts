import { describe, expect, it } from 'vitest';
import { defaultChannelRowsForGroupId, ensureDefaultHubChannelRows } from './hub-channel-rows';
import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  BOARD_CHANNEL_NAME,
  DOCS_CHANNEL_NAME,
  EVENTS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
} from './hub-channel-names';

describe('defaultChannelRowsForGroupId', () => {
  it('returns announcements and board on one group id', () => {
    expect(defaultChannelRowsForGroupId('g')).toEqual([
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: BOARD_CHANNEL_NAME, groupId: 'g', order: 1 },
    ]);
  });
});

describe('ensureDefaultHubChannelRows', () => {
  it('replaces legacy polls/events/docs with board and keeps custom channels after the defaults', () => {
    const persisted = [
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: POLLS_CHANNEL_NAME, groupId: 'g', order: 1 },
      { name: 'ops', groupId: 'g-ops', order: 2 },
      { name: 'secret', groupId: 'g-sec', order: 3 },
    ];
    const fixed = ensureDefaultHubChannelRows(persisted);
    expect(fixed).toEqual([
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: BOARD_CHANNEL_NAME, groupId: 'g', order: 1 },
      { name: 'ops', groupId: 'g-ops', order: 2 },
      { name: 'secret', groupId: 'g-sec', order: 3 },
    ]);
  });

  it('strips legacy events/docs shelves when board is missing', () => {
    const persisted = [
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: POLLS_CHANNEL_NAME, groupId: 'g', order: 1 },
      { name: EVENTS_CHANNEL_NAME, groupId: 'g', order: 2 },
      { name: DOCS_CHANNEL_NAME, groupId: 'g', order: 3 },
      { name: 'ops', groupId: 'g-ops', order: 4 },
    ];
    expect(ensureDefaultHubChannelRows(persisted).map((c) => c.name)).toEqual([
      ANNOUNCEMENTS_CHANNEL_NAME,
      BOARD_CHANNEL_NAME,
      'ops',
    ]);
  });

  it('backfills board when only announcements was persisted', () => {
    const fixed = ensureDefaultHubChannelRows([{ name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 }]);
    expect(fixed).toEqual(defaultChannelRowsForGroupId('g'));
  });

  it('leaves rows unchanged when every default exists', () => {
    const full = [...defaultChannelRowsForGroupId('g'), { name: 'ops', groupId: 'g-ops', order: 2 }];
    expect(ensureDefaultHubChannelRows(full)).toBe(full);
  });

  it('skips placeholder announcements rows', () => {
    const creating = [{ name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'creating-1', order: 0 }];
    expect(ensureDefaultHubChannelRows(creating)).toBe(creating);
  });

  it('backfills board on announcements group when shelves sit on a different MLS group', () => {
    const persisted = [
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g1', order: 0 },
      { name: EVENTS_CHANNEL_NAME, groupId: 'g2', order: 1 },
      { name: 'ops', groupId: 'g-ops', order: 2 },
    ];
    expect(ensureDefaultHubChannelRows(persisted)).toEqual([
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g1', order: 0 },
      { name: 'ops', groupId: 'g-ops', order: 2 },
      { name: BOARD_CHANNEL_NAME, groupId: 'g1', order: 3 },
    ]);
  });

  it('leaves announcements and board on distinct group ids unchanged', () => {
    const split = [
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'a', order: 0 },
      { name: BOARD_CHANNEL_NAME, groupId: 'b', order: 1 },
    ];
    expect(ensureDefaultHubChannelRows(split)).toEqual(split);
  });
});
