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
  { name: 'tools', groupId: 'g-ann', order: 1 },
  { name: 'polls', groupId: 'g-ann', order: 2 },
  { name: 'ops', groupId: 'g-ops', order: 3, access: 'open' },
  { name: 'secret', groupId: 'g-sec', order: 4, access: 'closed' },
  { name: 'legacy', groupId: 'g-leg', order: 5 },
  { name: 'alias', groupId: 'g-ann', order: 6, access: 'open' },
];

describe('channel-access', () => {
  it('treats missing access on custom channels as open', () => {
    expect(resolveChannelAccess(channels[5])).toBe('open');
    expect(isOpenCustomChannel(channels[5])).toBe(true);
  });

  it('lists distinct open custom targets including legacy rows', () => {
    expect(openCustomChannelTargets(channels).map((c) => c.groupId)).toEqual(['g-ops', 'g-leg']);
  });

  it('does not invite tools or any row on the announcements group', () => {
    expect(isOpenCustomChannel(channels[1])).toBe(false);
    expect(openCustomChannelTargets(channels).some((c) => c.groupId === 'g-ann')).toBe(false);
    expect(catalogChannelsForAnnounce(channels).some((c) => c.groupId === 'g-ann')).toBe(false);
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
      { name: 'ops', groupId: 'g-ops', order: 3, access: 'open' },
      { name: 'legacy', groupId: 'g-leg', order: 5, access: 'open' },
    ]);
  });

  it('keeps public access and does not treat unknown values as public', () => {
    const room: Channel = { name: 'room', groupId: 'g-pub', order: 8, access: 'public' };
    expect(resolveChannelAccess(room)).toBe('public');
    expect(isOpenCustomChannel(room)).toBe(false);
    const unknown = { name: 'room', groupId: 'g-x', order: 9, access: undefined } as Channel;
    expect(resolveChannelAccess(unknown)).toBe('open');
    expect(
      catalogChannelsForAnnounce([...channels, room]).some(
        (row) => row.groupId === 'g-pub' && row.access === 'public',
      ),
    ).toBe(true);
  });
});
