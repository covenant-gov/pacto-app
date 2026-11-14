import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  DOCS_CHANNEL_NAME,
  EVENTS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
  TOOLS_CHANNEL_NAME,
} from '../squad/hub-channel-names';
import type { Channel } from '../../stores/squads';

export type ChannelAccess = 'open' | 'closed' | 'public';

const HUB_CHANNEL_NAMES = new Set([
  ANNOUNCEMENTS_CHANNEL_NAME,
  TOOLS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
  EVENTS_CHANNEL_NAME,
  DOCS_CHANNEL_NAME,
]);

export function isHubChannelRow(ch: Pick<Channel, 'name' | 'groupId'>): boolean {
  return HUB_CHANNEL_NAMES.has(ch.name) || ch.groupId.startsWith('__');
}

/** Custom channels: explicit closed stays private; explicit public stays public. Missing access gossips as open. */
export function resolveChannelAccess(ch: Channel): ChannelAccess | null {
  if (isHubChannelRow(ch)) return null;
  if (ch.access === 'closed') return 'closed';
  if (ch.access === 'public') return 'public';
  return 'open';
}

export function isOpenCustomChannel(ch: Channel): boolean {
  return resolveChannelAccess(ch) === 'open';
}

function distinctCustomTargets(channels: Channel[], access: 'open' | 'public'): Channel[] {
  const announcementsGid = channels
    .find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)
    ?.groupId.trim()
    .toLowerCase();
  const seen = new Set<string>();
  const out: Channel[] = [];
  for (const ch of channels) {
    if (resolveChannelAccess(ch) !== access) continue;
    const gid = ch.groupId.trim();
    if (!gid || gid.startsWith('creating-') || seen.has(gid)) continue;
    if (announcementsGid && gid.toLowerCase() === announcementsGid) continue;
    seen.add(gid);
    out.push(ch);
  }
  return out;
}

/** Distinct physical MLS groups for open custom channels (skips placeholders). */
export function openCustomChannelTargets(channels: Channel[]): Channel[] {
  return distinctCustomTargets(channels, 'open');
}

/** Open and public custom channels — for announcements catalog republish. Closed stays off the catalog. */
export function catalogChannelsForAnnounce(channels: Channel[]): Array<{
  name: string;
  groupId: string;
  order: number;
  access: ChannelAccess;
}> {
  const rows = [
    ...distinctCustomTargets(channels, 'open').map((ch) => ({
      name: ch.name,
      groupId: ch.groupId,
      order: ch.order,
      access: 'open' as const,
    })),
    ...distinctCustomTargets(channels, 'public').map((ch) => ({
      name: ch.name,
      groupId: ch.groupId,
      order: ch.order,
      access: 'public' as const,
    })),
  ];
  return rows.sort((a, b) => a.order - b.order);
}
