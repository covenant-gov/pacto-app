/** Built-in squad hub sidebar channel slugs (not user-created chat channels). */

export const ANNOUNCEMENTS_CHANNEL_NAME = 'announcements';
export const TOOLS_CHANNEL_NAME = 'tools';

/** Tools segmented modes (also legacy MLS shelf names). */
export const POLLS_CHANNEL_NAME = 'polls';
export const EVENTS_CHANNEL_NAME = 'events';
export const DOCS_CHANNEL_NAME = 'docs';

/** Virtual squad-wide governance hub (not an MLS group). */
export const SQUAD_GOVERNANCE_CHANNEL_ID = '__governance__';
export const SQUAD_GOVERNANCE_CHANNEL_NAME = 'governance';

/** Internal Wargame stack id under `#governance` (not an MLS group; not a sidebar row). */
export const SQUAD_WARGAME_CHANNEL_ID = '__gov_practice__';
export const SQUAD_WARGAME_CHANNEL_NAME = 'gov-practice';

/** Virtual squad settings (not an MLS group). */
export const SETTINGS_CHANNEL_ID = '__squad_settings__';
export const SETTINGS_CHANNEL_NAME = 'settings';

/** Superseded hub slug; normalize to `tools`. */
const OBSOLETE_TOOLS_CHANNEL_NAME = 'board';

const OBSOLETE_DASHBOARD_IDS: Record<string, string> = {
  __my_dashboard__: SETTINGS_CHANNEL_ID,
  __squad_dashboard__: SQUAD_GOVERNANCE_CHANNEL_ID,
  __squad_wargame__: SQUAD_WARGAME_CHANNEL_ID,
};

/** Virtual hub rows: not MLS groups and not chat `VirtualBucket`s. */
export function isVirtualHubChannelId(id: string | null | undefined): boolean {
  return (
    id === SQUAD_GOVERNANCE_CHANNEL_ID ||
    id === SQUAD_WARGAME_CHANNEL_ID ||
    id === SETTINGS_CHANNEL_ID
  );
}

/** Obsolete virtual ids remap to current settings / governance / gov-practice. */
export function remapObsoleteHubChannelId(id: string | null | undefined): string | null | undefined {
  if (id == null) return id;
  return OBSOLETE_DASHBOARD_IDS[id] ?? id;
}

/** Squad-wide governance chrome (`governance` Live or Wargame stack). */
export function isSquadGovernanceChromeChannelId(id: string | null | undefined): boolean {
  return id === SQUAD_GOVERNANCE_CHANNEL_ID || id === SQUAD_WARGAME_CHANNEL_ID;
}

/** Default stack when no remembered chrome id. Practice-first when live `pacto_gov` is absent. */
export function defaultGovernanceStackChannelId(hasLivePactoGov: boolean): string {
  return hasLivePactoGov ? SQUAD_GOVERNANCE_CHANNEL_ID : SQUAD_WARGAME_CHANNEL_ID;
}

/** Restore last Live/Wargame chrome id, else practice-first default. */
export function resolveGovernanceChromeChannelId(
  lastChannelId: string | null | undefined,
  hasLivePactoGov: boolean,
): string {
  const remapped = remapObsoleteHubChannelId(lastChannelId) ?? null;
  if (remapped && isSquadGovernanceChromeChannelId(remapped)) return remapped;
  return defaultGovernanceStackChannelId(hasLivePactoGov);
}

/** Legacy shelf names / slug that now live under `#tools`. */
export function isObsoleteToolsShelfName(name: string | null | undefined): boolean {
  return (
    name === POLLS_CHANNEL_NAME ||
    name === EVENTS_CHANNEL_NAME ||
    name === DOCS_CHANNEL_NAME ||
    name === OBSOLETE_TOOLS_CHANNEL_NAME
  );
}

/**
 * Normalize persisted hub channel names.
 * Legacy polls/events/docs shelves and the superseded `board` slug become `tools`.
 */
export function normalizeHubChannelName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  if (isObsoleteToolsShelfName(trimmed)) return TOOLS_CHANNEL_NAME;
  return trimmed;
}

/** If a persisted hub name was a legacy shelf, return that tools mode; otherwise null. */
export function toolsModeFromObsoleteHubName(
  name: string | null | undefined,
): 'polls' | 'events' | 'docs' | null {
  const trimmed = name?.trim();
  if (trimmed === POLLS_CHANNEL_NAME || trimmed === EVENTS_CHANNEL_NAME || trimmed === DOCS_CHANNEL_NAME) {
    return trimmed;
  }
  return null;
}

/**
 * Normalize persisted hub names to current slugs, capturing tools mode from the
 * last-opened squad's raw obsolete shelf name before it becomes `tools`.
 */
export function migrateLastHubChannelNamesBySquad(
  entries: Record<string, string>,
  lastOpenedSquadId: string | null | undefined,
): {
  hubs: Record<string, string>;
  toolsModeFromLegacy: 'polls' | 'events' | 'docs' | null;
} {
  const hubs: Record<string, string> = {};
  let toolsModeFromLegacy: 'polls' | 'events' | 'docs' | null = null;
  const last = lastOpenedSquadId?.trim() || null;
  for (const [sid, name] of Object.entries(entries)) {
    if (typeof name !== 'string') continue;
    const mode = toolsModeFromObsoleteHubName(name);
    if (mode && last && sid === last) toolsModeFromLegacy = mode;
    const hub = normalizeHubChannelName(name);
    if (hub) hubs[sid] = hub;
  }
  return { hubs, toolsModeFromLegacy };
}
