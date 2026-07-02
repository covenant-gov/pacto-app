import { describe, expect, it } from 'vitest';
import { PERSONAL_ALERTS_CHANNEL_NAME, normalizeStoredChannel } from './squads';

describe('normalizeStoredChannel', () => {
  it('renames legacy monitor and inbox channel rows to personal-alerts', () => {
    expect(
      normalizeStoredChannel({ name: 'monitor', groupId: 'g1', order: 1 })
    ).toEqual({ name: PERSONAL_ALERTS_CHANNEL_NAME, groupId: 'g1', order: 1 });
    expect(
      normalizeStoredChannel({ name: 'inbox', groupId: 'g1', order: 1 })
    ).toEqual({ name: PERSONAL_ALERTS_CHANNEL_NAME, groupId: 'g1', order: 1 });
  });

  it('passes through personal-alerts and other channel names', () => {
    expect(
      normalizeStoredChannel({ name: PERSONAL_ALERTS_CHANNEL_NAME, groupId: 'g1', order: 1 })
    ).toEqual({ name: PERSONAL_ALERTS_CHANNEL_NAME, groupId: 'g1', order: 1 });
    expect(
      normalizeStoredChannel({ name: 'announcements', groupId: 'g1', order: 0 })
    ).toEqual({ name: 'announcements', groupId: 'g1', order: 0 });
  });
});
