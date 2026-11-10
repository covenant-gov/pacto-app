import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  TOOLS_CHANNEL_NAME,
  DOCS_CHANNEL_NAME,
  EVENTS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
} from './hub-channel-names';

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
  'board',
  POLLS_CHANNEL_NAME,
  EVENTS_CHANNEL_NAME,
  DOCS_CHANNEL_NAME,
]);

const DEFAULT_HUB_MLS_NAMES = [ANNOUNCEMENTS_CHANNEL_NAME, TOOLS_CHANNEL_NAME];

/** Default hub MLS rows for an announcements `groupId` (single-group default). */
export function defaultChannelRowsForGroupId(groupId: string): HubChannelRow[] {
  return DEFAULT_HUB_MLS_NAMES.map((name, order) => ({ name, groupId, order }));
}

/**
 * Backfill missing `#announcements` / `#tools` and strip obsolete hub rows when the
 * parent uses the single-group default MLS scope. Custom channels keep their relative order after the defaults.
 */
export function ensureDefaultHubChannelRows(channels: HubChannelRow[]): HubChannelRow[] {
  const ann = channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME);
  const tools = channels.find((c) => c.name === TOOLS_CHANNEL_NAME);
  const gid = (ann?.groupId ?? tools?.groupId)?.trim();
  if (!gid || gid.startsWith('creating-')) return channels;

  const hasAllDefaults = DEFAULT_HUB_MLS_NAMES.every((name) => channels.some((c) => c.name === name));
  const hasObsolete = channels.some((c) => OBSOLETE_DEFAULT_HUB_NAMES.has(c.name));
  if (hasAllDefaults && !hasObsolete) return channels;

  const mlsDefaults = channels.filter(
    (c) =>
      DEFAULT_HUB_MLS_NAMES.includes(c.name) ||
      (OBSOLETE_DEFAULT_HUB_NAMES.has(c.name) && !c.groupId.startsWith('__')),
  );
  const singleGroupDefault =
    mlsDefaults.length <= 1 || mlsDefaults.every((c) => c.groupId === gid);
  if (!singleGroupDefault) {
    const withoutObsolete = channels.filter((c) => !OBSOLETE_DEFAULT_HUB_NAMES.has(c.name));
    const withAnn = withoutObsolete.some((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)
      ? withoutObsolete
      : [{ name: ANNOUNCEMENTS_CHANNEL_NAME, groupId: gid, order: 0 }, ...withoutObsolete];
    if (withAnn.some((c) => c.name === TOOLS_CHANNEL_NAME)) return withAnn;
    const maxOrder = withAnn.reduce((m, c) => Math.max(m, c.order), -1);
    return [
      ...withAnn,
      { name: TOOLS_CHANNEL_NAME, groupId: gid, order: maxOrder + 1 },
    ];
  }

  const merged = defaultChannelRowsForGroupId(gid);
  const custom = channels
    .filter((c) => !DEFAULT_HUB_MLS_NAMES.includes(c.name) && !OBSOLETE_DEFAULT_HUB_NAMES.has(c.name))
    .map((c, i) => ({ ...c, order: merged.length + i }));
  return [...merged, ...custom];
}
