/** Built-in squad hub sidebar channel slugs (not user-created chat channels). */

export const ANNOUNCEMENTS_CHANNEL_NAME = 'announcements';
export const BOARD_CHANNEL_NAME = 'board';

/** Board segmented modes (also legacy MLS shelf names). */
export const POLLS_CHANNEL_NAME = 'polls';
export const EVENTS_CHANNEL_NAME = 'events';
export const DOCS_CHANNEL_NAME = 'docs';

/** Virtual squad-wide governance hub (not an MLS group). */
export const SQUAD_DASHBOARD_CHANNEL_ID = '__governance__';
export const SQUAD_DASHBOARD_CHANNEL_NAME = 'governance';

/** Virtual war-game / practice gov hub (not an MLS group). Shown after a completed war-game deploy. */
export const SQUAD_WARGAME_CHANNEL_ID = '__gov_practice__';
export const SQUAD_WARGAME_CHANNEL_NAME = 'gov-practice';

/** Virtual squad settings (not an MLS group). */
export const SETTINGS_CHANNEL_ID = '__squad_settings__';
export const SETTINGS_CHANNEL_NAME = 'settings';

const OBSOLETE_DASHBOARD_IDS: Record<string, string> = {
  __my_dashboard__: SETTINGS_CHANNEL_ID,
  __squad_dashboard__: SQUAD_DASHBOARD_CHANNEL_ID,
  __squad_wargame__: SQUAD_WARGAME_CHANNEL_ID,
};

/** Virtual hub rows: not MLS groups and not chat `VirtualBucket`s. */
export function isVirtualHubChannelId(id: string | null | undefined): boolean {
  return (
    id === SQUAD_DASHBOARD_CHANNEL_ID ||
    id === SQUAD_WARGAME_CHANNEL_ID ||
    id === SETTINGS_CHANNEL_ID
  );
}

/** Obsolete virtual ids remap to current settings / governance / gov-practice. */
export function remapObsoleteHubChannelId(id: string | null | undefined): string | null | undefined {
  if (id == null) return id;
  return OBSOLETE_DASHBOARD_IDS[id] ?? id;
}

/** Squad-wide governance chrome (`governance` or `gov-practice`). */
export function isSquadDashboardChromeChannelId(id: string | null | undefined): boolean {
  return id === SQUAD_DASHBOARD_CHANNEL_ID || id === SQUAD_WARGAME_CHANNEL_ID;
}

/** Legacy shelf names that now live under `#board`. */
export function isObsoleteBoardShelfName(name: string | null | undefined): boolean {
  return name === POLLS_CHANNEL_NAME || name === EVENTS_CHANNEL_NAME || name === DOCS_CHANNEL_NAME;
}

/**
 * Normalize persisted hub channel names.
 * Legacy polls/events/docs shelf names become `board`.
 */
export function normalizeHubChannelName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  if (isObsoleteBoardShelfName(trimmed)) return BOARD_CHANNEL_NAME;
  return trimmed;
}

/** If a persisted hub name was a legacy shelf, return that board mode; otherwise null. */
export function boardModeFromObsoleteHubName(
  name: string | null | undefined,
): 'polls' | 'events' | 'docs' | null {
  const trimmed = name?.trim();
  if (trimmed === POLLS_CHANNEL_NAME || trimmed === EVENTS_CHANNEL_NAME || trimmed === DOCS_CHANNEL_NAME) {
    return trimmed;
  }
  return null;
}
