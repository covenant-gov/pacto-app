import { describe, expect, it } from 'vitest';
import { defaultChannelRowsForGroupId, ensureDefaultHubChannelRows } from './hub-channel-rows';
import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  EVENTS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
} from './hub-channel-names';

describe('defaultChannelRowsForGroupId', () => {
  it('returns announcements, polls, events on one group id', () => {
    expect(defaultChannelRowsForGroupId('g')).toEqual([
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: POLLS_CHANNEL_NAME, groupId: 'g', order: 1 },
      { name: EVENTS_CHANNEL_NAME, groupId: 'g', order: 2 },
    ]);
  });
});

describe('ensureDefaultHubChannelRows', () => {
  it('backfills #events beside #polls and keeps custom channels after the defaults', () => {
    const persisted = [
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: POLLS_CHANNEL_NAME, groupId: 'g', order: 1 },
      { name: 'ops', groupId: 'g-ops', order: 2 },
      { name: 'secret', groupId: 'g-sec', order: 3 },
    ];
    const fixed = ensureDefaultHubChannelRows(persisted);
    expect(fixed).toEqual([
      { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 },
      { name: POLLS_CHANNEL_NAME, groupId: 'g', order: 1 },
      { name: EVENTS_CHANNEL_NAME, groupId: 'g', order: 2 },
      { name: 'ops', groupId: 'g-ops', order: 3 },
      { name: 'secret', groupId: 'g-sec', order: 4 },
    ]);
  });

  it('backfills polls and events when only announcements was persisted', () => {
    const fixed = ensureDefaultHubChannelRows([{ name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'g', order: 0 }]);
    expect(fixed).toEqual(defaultChannelRowsForGroupId('g'));
  });

  it('leaves rows unchanged when every default exists', () => {
    const full = [...defaultChannelRowsForGroupId('g'), { name: 'ops', groupId: 'g-ops', order: 3 }];
    expect(ensureDefaultHubChannelRows(full)).toBe(full);
  });

  it('skips placeholder announcements rows', () => {
    const creating = [{ name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: 'creating-1', order: 0 }];
    expect(ensureDefaultHubChannelRows(creating)).toBe(creating);
  });
});
