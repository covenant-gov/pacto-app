import { describe, expect, it } from 'vitest';
import {
  publicChannelIds,
  publicChannelRoster,
  visiblePublicChannelMessages,
} from './public-channel';
import type { Squad } from '../../stores/squads';

const squad = {
  id: 'ann',
  name: 's',
  channels: [
    { name: 'announcements', groupId: 'ann', order: 0 },
    { name: 'room', groupId: 'aa'.repeat(32), order: 1, access: 'public' },
    { name: 'draft', groupId: 'creating-1', order: 2, access: 'public' },
    { name: 'ops', groupId: 'g-ops', order: 3, access: 'open' },
  ],
  kind: 'squad',
  createdAt: 1,
  updatedAt: 1,
} as Squad;

describe('public channel roster filter', () => {
  it('collects real public channel ids only', () => {
    expect(publicChannelIds([squad])).toEqual(['aa'.repeat(32)]);
  });

  it('includes the current user in the roster', () => {
    expect(publicChannelRoster(['npub-a'], 'npub-me')).toEqual(new Set(['npub-a', 'npub-me']));
  });

  it('shows members and hides outsiders', () => {
    const roster = publicChannelRoster(['npub-a'], 'npub-me');
    const visible = visiblePublicChannelMessages(
      [
        { id: '1', mine: false, npub: 'npub-a' },
        { id: '2', mine: false, npub: 'npub-stranger' },
        { id: '3', mine: true, npub: 'npub-me' },
        { id: '4', mine: false, npub: null },
      ],
      roster,
    );
    expect(visible.map((message) => message.id)).toEqual(['1', '3']);
  });
});
