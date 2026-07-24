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

/** #squad-dashboard segmented mode; unknown persisted values reset to `status`. */
export type SquadDashboardChannelMode =
  | 'status'
  | 'governance'
  | 'treasury'
  | 'roles'
  | 'crew';

export const SQUAD_DASHBOARD_MODE_PREFIX = 'pacto_squad_dashboard_mode';

export function parseSquadDashboardChannelMode(raw: string | null): SquadDashboardChannelMode {
  const v = raw?.trim();
  if (v === 'status' || v === 'governance' || v === 'treasury' || v === 'roles' || v === 'crew') {
    return v;
  }
  return 'status';
}

export const squadDashboardChannelMode = writable<SquadDashboardChannelMode>('status');

/** #my-dashboard segmented mode; unknown persisted values reset to `status`. */
export type MyDashboardChannelMode = 'status' | 'alerts';

export const MY_DASHBOARD_MODE_PREFIX = 'pacto_my_dashboard_mode';

export function parseMyDashboardChannelMode(raw: string | null): MyDashboardChannelMode {
  const v = raw?.trim();
  if (v === 'status' || v === 'alerts') return v;
  return 'status';
}

export const myDashboardChannelMode = writable<MyDashboardChannelMode>('status');

/** Bumped when the Rust SQLite poll replica changes for a parent (local or remote MLS ingest). */
export const dashboardPollReplicaNonceByParentId = writable<Record<string, number>>({});

/** Bumped when peer MLS allowlist announces apply — panels refetch. */
export const squadAllowlistNonceByParentId = writable<Record<string, number>>({});

/** Bumped when peer MLS tracked-token announces apply — panels refetch. */
export const squadTrackedTokensNonceByParentId = writable<Record<string, number>>({});

/** Bumped when squad bot meta / key_rotated MLS announces apply. */
export const squadBotMetaNonceBySquadId = writable<Record<string, number>>({});

squadDashboardChannelMode.subscribe((mode) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(SQUAD_DASHBOARD_MODE_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, mode);
  } catch {
    // ignore quota
  }
});

myDashboardChannelMode.subscribe((mode) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(MY_DASHBOARD_MODE_PREFIX);
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
export const SQUAD_NAV_ORDER_PREFIX = 'pacto_squad_nav_order';

export const lastOpenedSquadId = writable<string | null>(null);
export const lastOpenedChannelId = writable<string | null>(null);
export const lastChannelBySquadId = writable<Record<string, string>>({});
export const lastHubChannelNameBySquadId = writable<Record<string, string>>({});
/** Manual Discord-style squad rail order (squad ids, top → bottom). */
export const squadNavOrder = writable<string[]>([]);

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
squadNavOrder.subscribe((ids) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(SQUAD_NAV_ORDER_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // ignore quota
  }
});
