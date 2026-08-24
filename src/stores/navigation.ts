import { get, writable } from 'svelte/store';
import { SETTINGS_CHANNEL_ID } from '../lib/squad/hub-channel-names';
import type { SquadNetworkSlot } from '../lib/squad/squad-network';
import { persistenceKey } from './persistence-context';

export type TopNavTab = 'commons' | 'dms' | 'squads' | 'catchup';
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
  | 'crew';

export const SQUAD_DASHBOARD_MODE_PREFIX = 'pacto_squad_dashboard_mode';

export function parseSquadDashboardChannelMode(raw: string | null): SquadDashboardChannelMode {
  const v = raw?.trim();
  if (v === 'status' || v === 'governance' || v === 'treasury' || v === 'crew') {
    return v;
  }
  return 'status';
}

export const squadDashboardChannelMode = writable<SquadDashboardChannelMode>('status');

/** #settings segmented mode; unknown persisted values reset to `personal`. */
export type SettingsChannelMode = 'personal' | 'squad';

export const SETTINGS_CHANNEL_MODE_PREFIX = 'pacto_settings_channel_mode';

export function parseSettingsChannelMode(raw: string | null): SettingsChannelMode {
  const v = raw?.trim();
  if (v === 'personal' || v === 'squad') return v;
  return 'personal';
}

export const settingsChannelMode = writable<SettingsChannelMode>('personal');

function openSquadSettingsChannel(mode?: SettingsChannelMode) {
  const squadId = get(activeSquadId);
  activeChannelId.set(SETTINGS_CHANNEL_ID);
  activeHubChannelName.set(null);
  activeView.set('hub');
  if (mode) settingsChannelMode.set(mode);
  if (!squadId) return;
  lastChannelBySquadId.update((m) => ({ ...m, [squadId]: SETTINGS_CHANNEL_ID }));
  lastHubChannelNameBySquadId.update((m) => {
    const next = { ...m };
    delete next[squadId];
    return next;
  });
}

/** Bumped to open #settings → Add custom RPC after a dashboard RPC read failure. */
export const squadSettingsRpcFocusNonce = writable(0);

export function focusSquadSettingsRpcEditor() {
  openSquadSettingsChannel('squad');
  squadSettingsRpcFocusNonce.update((n) => n + 1);
}

/** Bumped to open #settings → network editor from the Status checklist CTA. */
export const squadSettingsNetworkFocusNonce = writable(0);
export const squadSettingsNetworkFocusSlot = writable<SquadNetworkSlot>('primary');

export function focusSquadSettingsNetworkEditor(slot: SquadNetworkSlot = 'primary') {
  openSquadSettingsChannel('squad');
  squadSettingsNetworkFocusSlot.set(slot);
  squadSettingsNetworkFocusNonce.update((n) => n + 1);
}

/** Bumped when the Rust SQLite poll replica changes for a parent (local or remote MLS ingest). */
export const dashboardPollReplicaNonceByParentId = writable<Record<string, number>>({});

/** Bumped when peer MLS allowlist announces apply — panels refetch. */
export const squadAllowlistNonceByParentId = writable<Record<string, number>>({});

/** Bumped when peer MLS tracked-token announces apply — panels refetch. */
export const squadTrackedTokensNonceByParentId = writable<Record<string, number>>({});

/** Bumped when MLS governance process hints apply — hats, crew maps, ACL, and proposals revalidate from chain. */
export const governanceProcessNonceByParentId = writable<Record<string, number>>({});

/** Invalidate on-chain gov UI snapshots for this parent (local write or MLS ingest). */
export function bumpGovernanceProcessNonce(parentId: string): void {
  const id = parentId.trim();
  if (!id) return;
  governanceProcessNonceByParentId.update((m) => ({ ...m, [id]: (m[id] ?? 0) + 1 }));
}

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

settingsChannelMode.subscribe((mode) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(SETTINGS_CHANNEL_MODE_PREFIX);
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
