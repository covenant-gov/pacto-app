/** Built-in squad hub sidebar channel slugs (not user-created chat channels). */

export const ANNOUNCEMENTS_CHANNEL_NAME = 'announcements';
export const POLLS_CHANNEL_NAME = 'polls';

/** Virtual squad-wide dashboard (not an MLS group). */
export const SQUAD_DASHBOARD_CHANNEL_ID = '__squad_dashboard__';
export const SQUAD_DASHBOARD_CHANNEL_NAME = 'squad-dashboard';

/** Virtual member dashboard (not an MLS group). Alerts read the MLS `inbox` bucket. */
export const MY_DASHBOARD_CHANNEL_ID = '__my_dashboard__';
export const MY_DASHBOARD_CHANNEL_NAME = 'my-dashboard';

/** Virtual war-game hub (not an MLS group). Shown after a completed war-game deploy. */
export const SQUAD_WARGAME_CHANNEL_ID = '__squad_wargame__';
export const SQUAD_WARGAME_CHANNEL_NAME = 'squad-wargame';

/** Virtual squad settings (not an MLS group). */
export const SETTINGS_CHANNEL_ID = '__squad_settings__';
export const SETTINGS_CHANNEL_NAME = 'settings';

/** Virtual hub rows: not MLS groups and not chat `VirtualBucket`s. */
export function isVirtualHubChannelId(id: string | null | undefined): boolean {
  return (
    id === SQUAD_DASHBOARD_CHANNEL_ID ||
    id === MY_DASHBOARD_CHANNEL_ID ||
    id === SQUAD_WARGAME_CHANNEL_ID ||
    id === SETTINGS_CHANNEL_ID
  );
}

/** Squad-wide dashboard chrome (`squad-dashboard` or `squad-wargame`). */
export function isSquadDashboardChromeChannelId(id: string | null | undefined): boolean {
  return id === SQUAD_DASHBOARD_CHANNEL_ID || id === SQUAD_WARGAME_CHANNEL_ID;
}

/** Normalize persisted hub channel names. */
export function normalizeHubChannelName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed;
}
