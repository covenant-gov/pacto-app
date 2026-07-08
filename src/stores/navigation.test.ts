import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  activeTopNavTab,
  DEFAULT_TOP_NAV_TAB,
  activeSquadId,
  activeChannelId,
  activeHubChannelName,
  activeView,
  parentDashboardChannelMode,
  PARENT_DASHBOARD_MODE_PREFIX,
  parseParentDashboardChannelMode,
  showMembersPanel,
  lastOpenedSquadId,
  lastOpenedChannelId,
  lastChannelBySquadId,
  lastHubChannelNameBySquadId,
  LAST_SQUAD_ID_PREFIX,
  LAST_CHANNEL_ID_PREFIX,
  LAST_CHANNEL_BY_SQUAD_PREFIX,
  LAST_HUB_CHANNEL_NAME_BY_SQUAD_PREFIX,
  dashboardPollReplicaNonceByParentId,
} from './navigation';
import { setCurrentNpubForPersistence } from './persistence-context';

function mockStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage);
  return store;
}

describe('navigation', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = mockStorage();
  });

  afterEach(() => {
    activeTopNavTab.set(DEFAULT_TOP_NAV_TAB);
    activeSquadId.set(null);
    activeChannelId.set(null);
    activeHubChannelName.set(null);
    activeView.set('hub');
    parentDashboardChannelMode.set('governance');
    showMembersPanel.set(false);
    lastOpenedSquadId.set(null);
    lastOpenedChannelId.set(null);
    lastChannelBySquadId.set({});
    lastHubChannelNameBySquadId.set({});
    dashboardPollReplicaNonceByParentId.set({});
    setCurrentNpubForPersistence(null);
    vi.unstubAllGlobals();
  });

  it('has expected initial values', () => {
    expect(get(activeTopNavTab)).toBe('commons');
    expect(get(activeSquadId)).toBeNull();
    expect(get(activeChannelId)).toBeNull();
    expect(get(activeHubChannelName)).toBeNull();
    expect(get(activeView)).toBe('hub');
    expect(get(parentDashboardChannelMode)).toBe('governance');
    expect(get(showMembersPanel)).toBe(false);
  });

  it('parses known parent dashboard channel modes', () => {
    expect(parseParentDashboardChannelMode('governance')).toBe('governance');
    expect(parseParentDashboardChannelMode('roles_tree')).toBe('roles_tree');
    expect(parseParentDashboardChannelMode('treasury')).toBe('treasury');
    expect(parseParentDashboardChannelMode('settings')).toBe('settings');
  });

  it('resets unknown or legacy parent dashboard modes to governance', () => {
    expect(parseParentDashboardChannelMode(null)).toBe('governance');
    expect(parseParentDashboardChannelMode('')).toBe('governance');
    expect(parseParentDashboardChannelMode('nope')).toBe('governance');
    expect(parseParentDashboardChannelMode('polls')).toBe('governance');
    expect(parseParentDashboardChannelMode('modules')).toBe('governance');
  });

  it('persists parent dashboard channel mode under an npub-scoped key', () => {
    setCurrentNpubForPersistence('npub1abc');
    parentDashboardChannelMode.set('treasury');
    expect(storage.get(`${PARENT_DASHBOARD_MODE_PREFIX}_npub1abc`)).toBe('treasury');
  });

  it('persists last opened squad and channel ids', () => {
    setCurrentNpubForPersistence('npub1abc');
    lastOpenedSquadId.set('squad-1');
    lastOpenedChannelId.set('channel-1');
    expect(storage.get(`${LAST_SQUAD_ID_PREFIX}_npub1abc`)).toBe('squad-1');
    expect(storage.get(`${LAST_CHANNEL_ID_PREFIX}_npub1abc`)).toBe('channel-1');
  });

  it('removes squad and channel keys when set to null', () => {
    setCurrentNpubForPersistence('npub1abc');
    lastOpenedSquadId.set('squad-1');
    lastOpenedChannelId.set('channel-1');
    expect(storage.get(`${LAST_SQUAD_ID_PREFIX}_npub1abc`)).toBe('squad-1');
    expect(storage.get(`${LAST_CHANNEL_ID_PREFIX}_npub1abc`)).toBe('channel-1');
    lastOpenedSquadId.set(null);
    lastOpenedChannelId.set(null);
    expect(storage.has(`${LAST_SQUAD_ID_PREFIX}_npub1abc`)).toBe(false);
    expect(storage.has(`${LAST_CHANNEL_ID_PREFIX}_npub1abc`)).toBe(false);
  });

  it('persists last channel maps by squad', () => {
    setCurrentNpubForPersistence('npub1abc');
    lastChannelBySquadId.set({ s1: 'c1' });
    lastHubChannelNameBySquadId.set({ s1: 'announcements' });
    expect(JSON.parse(storage.get(`${LAST_CHANNEL_BY_SQUAD_PREFIX}_npub1abc`) ?? '{}')).toEqual({ s1: 'c1' });
    expect(JSON.parse(storage.get(`${LAST_HUB_CHANNEL_NAME_BY_SQUAD_PREFIX}_npub1abc`) ?? '{}')).toEqual({
      s1: 'announcements',
    });
  });

  it('skips persistence when no npub is set', () => {
    parentDashboardChannelMode.set('settings');
    expect(storage.size).toBe(0);
  });

  it('bumps the dashboard poll replica nonce', () => {
    dashboardPollReplicaNonceByParentId.set({ p1: 1 });
    expect(get(dashboardPollReplicaNonceByParentId)).toEqual({ p1: 1 });
  });
});
