import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  PERSONAL_ALERTS_CHANNEL_NAME,
  POLLS_CHANNEL_NAME,
} from './hub-channel-names';

export interface HubChannelRow {
  name: string;
  groupId: string;
  order: number;
}

/** Default hub sidebar rows for an existing announcements MLS `groupId` (single-group default). */
export function defaultChannelRowsForGroupId(groupId: string): HubChannelRow[] {
  return [
    { name: ANNOUNCEMENTS_CHANNEL_NAME, groupId, order: 0 },
    { name: PERSONAL_ALERTS_CHANNEL_NAME, groupId, order: 1 },
    { name: POLLS_CHANNEL_NAME, groupId, order: 2 },
  ];
}

/**
 * Backfill missing `#personal-alerts` / `#polls` rows when a parent only persisted `#announcements`
 * (invite accept) but uses the single-group default MLS scope.
 */
export function ensureDefaultHubChannelRows(channels: HubChannelRow[]): HubChannelRow[] {
  const ann = channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME);
  const gid = ann?.groupId?.trim();
  if (!gid || gid.startsWith('creating-')) return channels;

  const hasPersonalAlerts = channels.some((c) => c.name === PERSONAL_ALERTS_CHANNEL_NAME);
  const hasPolls = channels.some((c) => c.name === POLLS_CHANNEL_NAME);
  if (hasPersonalAlerts && hasPolls) return channels;

  const defaultRows = channels.filter(
    (c) =>
      c.name === ANNOUNCEMENTS_CHANNEL_NAME ||
      c.name === PERSONAL_ALERTS_CHANNEL_NAME ||
      c.name === POLLS_CHANNEL_NAME
  );
  const singleGroupDefault =
    defaultRows.length <= 1 || defaultRows.every((c) => c.groupId === ann!.groupId);
  if (!singleGroupDefault) return channels;

  const extras = channels.filter(
    (c) =>
      c.name !== ANNOUNCEMENTS_CHANNEL_NAME &&
      c.name !== PERSONAL_ALERTS_CHANNEL_NAME &&
      c.name !== POLLS_CHANNEL_NAME
  );
  const merged = defaultChannelRowsForGroupId(gid);
  const custom = extras.map((c, i) => ({ ...c, order: 3 + i }));
  return [...merged, ...custom];
}
