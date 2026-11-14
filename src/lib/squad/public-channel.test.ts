import { describe, expect, it } from 'vitest';
import { publicChannelIds } from './public-channel';
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

describe('public channel ids', () => {
  it('collects real public channel ids only', () => {
    expect(publicChannelIds([squad])).toEqual(['aa'.repeat(32)]);
  });
});
