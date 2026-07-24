import { describe, expect, it } from 'vitest';
import {
  catalogChannelsForAnnounce,
  isOpenCustomChannel,
  openCustomChannelTargets,
  resolveChannelAccess,
} from './channel-access';
import type { Channel } from '../../stores/squads';

const channels: Channel[] = [
  { name: 'announcements', groupId: 'g-ann', order: 0 },
  { name: 'polls', groupId: 'g-ann', order: 1 },
  { name: 'ops', groupId: 'g-ops', order: 2, access: 'open' },
  { name: 'secret', groupId: 'g-sec', order: 3, access: 'closed' },
  { name: 'legacy', groupId: 'g-leg', order: 4 },
];

describe('channel-access', () => {
  it('treats missing access on custom channels as open', () => {
    expect(resolveChannelAccess(channels[4])).toBe('open');
    expect(isOpenCustomChannel(channels[4])).toBe(true);
  });

  it('lists distinct open custom targets including legacy rows', () => {
    expect(openCustomChannelTargets(channels).map((c) => c.groupId)).toEqual(['g-ops', 'g-leg']);
  });

  it('skips creating placeholders, blanks, and duplicate group ids', () => {
    const messy: Channel[] = [
      { name: 'a', groupId: 'creating-1', order: 1, access: 'open' },
      { name: 'b', groupId: '  ', order: 2, access: 'open' },
      { name: 'c', groupId: 'g-dup', order: 3, access: 'open' },
      { name: 'd', groupId: 'g-dup', order: 4, access: 'open' },
      { name: 'hub', groupId: '__polls', order: 5 },
    ];
    expect(openCustomChannelTargets(messy).map((c) => c.groupId)).toEqual(['g-dup']);
  });

  it('catalog announce includes open and legacy customs, not closed', () => {
    expect(catalogChannelsForAnnounce(channels)).toEqual([
      { name: 'ops', groupId: 'g-ops', order: 2, access: 'open' },
      { name: 'legacy', groupId: 'g-leg', order: 4, access: 'open' },
    ]);
  });
});
