import { writable } from 'svelte/store';
import { persistenceKey } from './persistence-context';

export type TopNavTab = 'commons' | 'dms' | 'squads';
export const DEFAULT_TOP_NAV_TAB: TopNavTab = 'commons';
export const activeTopNavTab = writable<TopNavTab>(DEFAULT_TOP_NAV_TAB);

export const activeSquadId = writable<string | null>(null);
export const activeChannelId = writable<string | null>(null);
/** Disambiguates the selected hub row when multiple channels share one MLS group id. */
export const activeHubChannelName = writable<string | null>(null);

export type ViewType = 'hub' | 'profile';
export const activeView = writable<ViewType>('hub');

/** #dashboard segmented mode: one remembered tab per account; unknown persisted values reset to `governance`. */
export type ParentDashboardChannelMode = 'governance' | 'roles_tree' | 'treasury' | 'settings';

export const PARENT_DASHBOARD_MODE_PREFIX = 'pacto_parent_dashboard_mode';

export function parseParentDashboardChannelMode(raw: string | null): ParentDashboardChannelMode {
  const v = raw?.trim();
  if (v === 'governance' || v === 'roles_tree' || v === 'treasury' || v === 'settings') return v;
  return 'governance';
}

export const parentDashboardChannelMode = writable<ParentDashboardChannelMode>('governance');

/** Bumped when the Rust SQLite poll replica changes for a parent (local or remote MLS ingest). */
export const dashboardPollReplicaNonceByParentId = writable<Record<string, number>>({});

parentDashboardChannelMode.subscribe((mode) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PARENT_DASHBOARD_MODE_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, mode);
  } catch {
    // ignore quota
  }
});

export const showMembersPanel = writable<boolean>(false);

export const LAST_SQUAD_ID_PREFIX = 'pacto_last_squad_id';
export const LAST_CHANNEL_ID_PREFIX = 'pacto_last_channel_id';
export const LAST_CHANNEL_BY_SQUAD_PREFIX = 'pacto_last_channel_by_squad';
export const LAST_HUB_CHANNEL_NAME_BY_SQUAD_PREFIX = 'pacto_last_hub_channel_name_by_squad';

export const lastOpenedSquadId = writable<string | null>(null);
export const lastOpenedChannelId = writable<string | null>(null);
export const lastChannelBySquadId = writable<Record<string, string>>({});
export const lastHubChannelNameBySquadId = writable<Record<string, string>>({});

lastOpenedSquadId.subscribe((id) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_SQUAD_ID_PREFIX);
  if (!key) return;
  if (id) localStorage.setItem(key, id);
  else localStorage.removeItem(key);
});
lastOpenedChannelId.subscribe((id) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_CHANNEL_ID_PREFIX);
  if (!key) return;
  if (id) localStorage.setItem(key, id);
  else localStorage.removeItem(key);
});
lastChannelBySquadId.subscribe((map) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_CHANNEL_BY_SQUAD_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore quota
  }
});
lastHubChannelNameBySquadId.subscribe((map) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(LAST_HUB_CHANNEL_NAME_BY_SQUAD_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore quota
  }
});
