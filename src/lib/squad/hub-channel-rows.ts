import { ANNOUNCEMENTS_CHANNEL_NAME, POLLS_CHANNEL_NAME } from './hub-channel-names';

export interface HubChannelRow {
  name: string;
  groupId: string;
  order: number;
}

const OBSOLETE_DEFAULT_HUB_NAMES = new Set([
  'personal-alerts',
  'monitor',
  'inbox',
  'join-requests',
  'dashboard',
]);

/** Default hub MLS rows for an announcements `groupId` (single-group default). */
export function defaultChannelRowsForGroupId(groupId: string): HubChannelRow[] {
  return [
    { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId, order: 0 },
    { name: POLLS_CHANNEL_NAME, groupId, order: 1 },
  ];
}

/**
 * Backfill missing `#polls` and strip obsolete hub rows when the parent uses the
 * single-group default MLS scope.
 */
export function ensureDefaultHubChannelRows(channels: HubChannelRow[]): HubChannelRow[] {
  const ann = channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME);
  const gid = ann?.groupId?.trim();
  if (!gid || gid.startsWith('creating-')) return channels;

  const hasPolls = channels.some((c) => c.name === POLLS_CHANNEL_NAME);
  const hasObsolete = channels.some((c) => OBSOLETE_DEFAULT_HUB_NAMES.has(c.name));
  if (hasPolls && !hasObsolete) return channels;

  const mlsDefaults = channels.filter(
    (c) =>
      c.name === ANNOUNCEMENTS_CHANNEL_NAME ||
      c.name === POLLS_CHANNEL_NAME ||
      (OBSOLETE_DEFAULT_HUB_NAMES.has(c.name) && !c.groupId.startsWith('__'))
  );
  const singleGroupDefault =
    mlsDefaults.length <= 1 || mlsDefaults.every((c) => c.groupId === ann!.groupId);
  if (!singleGroupDefault) {
    return channels.filter((c) => !OBSOLETE_DEFAULT_HUB_NAMES.has(c.name));
  }

  const extras = channels.filter(
    (c) =>
      c.name !== ANNOUNCEMENTS_CHANNEL_NAME &&
      c.name !== POLLS_CHANNEL_NAME &&
      !OBSOLETE_DEFAULT_HUB_NAMES.has(c.name)
  );
  const merged = defaultChannelRowsForGroupId(gid);
  const custom = extras.map((c, i) => ({ ...c, order: 2 + i }));
  return [...merged, ...custom];
}
