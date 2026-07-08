/** Built-in squad hub sidebar channel slugs (not user-created chat channels). */

export const ANNOUNCEMENTS_CHANNEL_NAME = 'announcements';
/** Virtual squad hub row for Commons join requests (not an MLS group). */
export const JOIN_REQUESTS_CHANNEL_ID = '__join_requests__';
export const JOIN_REQUESTS_CHANNEL_NAME = 'join-requests';
/** Squad hub row for automation / roster alerts (MLS virtual bucket remains `inbox`). */
export const PERSONAL_ALERTS_CHANNEL_NAME = 'personal-alerts';
export const POLLS_CHANNEL_NAME = 'polls';
export const DASHBOARD_CHANNEL_ID = '__dashboard__';
export const DASHBOARD_CHANNEL_NAME = 'dashboard';

const LEGACY_PERSONAL_ALERTS_CHANNEL_NAMES = new Set(['monitor', 'inbox']);

/** Normalize persisted hub channel names (legacy `inbox` / `monitor` → `personal-alerts`). */
export function normalizeHubChannelName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  if (LEGACY_PERSONAL_ALERTS_CHANNEL_NAMES.has(trimmed)) return PERSONAL_ALERTS_CHANNEL_NAME;
  return trimmed;
}
