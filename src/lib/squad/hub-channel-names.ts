/** Built-in squad hub sidebar channel slugs (not user-created chat channels). */

export const ANNOUNCEMENTS_CHANNEL_NAME = 'announcements';
export const POLLS_CHANNEL_NAME = 'polls';

/** Virtual squad-wide dashboard (not an MLS group). */
export const SQUAD_DASHBOARD_CHANNEL_ID = '__squad_dashboard__';
export const SQUAD_DASHBOARD_CHANNEL_NAME = 'squad-dashboard';

/** Virtual member dashboard (not an MLS group). Alerts read the MLS `inbox` bucket. */
export const MY_DASHBOARD_CHANNEL_ID = '__my_dashboard__';
export const MY_DASHBOARD_CHANNEL_NAME = 'my-dashboard';

/** Normalize persisted hub channel names. */
export function normalizeHubChannelName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed;
}
