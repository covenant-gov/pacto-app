import { describe, expect, it } from 'vitest';
import { INBOX_CHANNEL_NAME, normalizeStoredChannel } from './app';

describe('normalizeStoredChannel', () => {
  it('renames legacy monitor channel rows to inbox', () => {
    expect(
      normalizeStoredChannel({ name: 'monitor', groupId: 'g1', order: 1 })
    ).toEqual({ name: INBOX_CHANNEL_NAME, groupId: 'g1', order: 1 });
  });

  it('passes through inbox and other channel names', () => {
    expect(
      normalizeStoredChannel({ name: INBOX_CHANNEL_NAME, groupId: 'g1', order: 1 })
    ).toEqual({ name: INBOX_CHANNEL_NAME, groupId: 'g1', order: 1 });
    expect(
      normalizeStoredChannel({ name: 'announcements', groupId: 'g1', order: 0 })
    ).toEqual({ name: 'announcements', groupId: 'g1', order: 0 });
  });
});
