import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
} from '../squad/hub-channel-names';
import type { Channel } from '../../stores/squads';

export type ChannelAccess = 'open' | 'closed';

const HUB_CHANNEL_NAMES = new Set([ANNOUNCEMENTS_CHANNEL_NAME, POLLS_CHANNEL_NAME]);

export function isHubChannelRow(ch: Pick<Channel, 'name' | 'groupId'>): boolean {
  return HUB_CHANNEL_NAMES.has(ch.name) || ch.groupId.startsWith('__');
}

/** Custom channels: explicit closed stays private; missing access gossips as open (pre-access rows). */
export function resolveChannelAccess(ch: Channel): ChannelAccess | null {
  if (isHubChannelRow(ch)) return null;
  if (ch.access === 'closed') return 'closed';
  return 'open';
}

export function isOpenCustomChannel(ch: Channel): boolean {
  return resolveChannelAccess(ch) === 'open';
}

/** Distinct physical MLS groups for open custom channels (skips placeholders). */
export function openCustomChannelTargets(channels: Channel[]): Channel[] {
  const seen = new Set<string>();
  const out: Channel[] = [];
  for (const ch of channels) {
    if (!isOpenCustomChannel(ch)) continue;
    const gid = ch.groupId.trim();
    if (!gid || gid.startsWith('creating-') || seen.has(gid)) continue;
    seen.add(gid);
    out.push(ch);
  }
  return out;
}

/** Open custom channels only — for announcements catalog republish. */
export function catalogChannelsForAnnounce(channels: Channel[]): Array<{
  name: string;
  groupId: string;
  order: number;
  access: ChannelAccess;
}> {
  return openCustomChannelTargets(channels).map((ch) => ({
    name: ch.name,
    groupId: ch.groupId,
    order: ch.order,
    access: 'open',
  }));
}
