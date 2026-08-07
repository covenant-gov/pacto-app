import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  activeTopNavTab,
  DEFAULT_TOP_NAV_TAB,
  activeSquadId,
  activeChannelId,
  activeHubChannelName,
  activeView,
  squadDashboardChannelMode,
  SQUAD_DASHBOARD_MODE_PREFIX,
  parseSquadDashboardChannelMode,
  showMembersPanel,
  lastOpenedSquadId,
  lastOpenedChannelId,
  lastChannelBySquadId,
  lastHubChannelNameBySquadId,
  squadNavOrder,
  LAST_SQUAD_ID_PREFIX,
  LAST_CHANNEL_ID_PREFIX,
  LAST_CHANNEL_BY_SQUAD_PREFIX,
  LAST_HUB_CHANNEL_NAME_BY_SQUAD_PREFIX,
  SQUAD_NAV_ORDER_PREFIX,
  dashboardPollReplicaNonceByParentId,
  squadAllowlistNonceByParentId,
  squadTrackedTokensNonceByParentId,
  squadBotMetaNonceBySquadId,
} from './navigation';
import { setCurrentNpubForPersistence } from './persistence-context';
import { parseSquadNavOrder } from '../lib/squad/squad-nav-order';

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
    squadDashboardChannelMode.set('status');
    showMembersPanel.set(false);
    lastOpenedSquadId.set(null);
    lastOpenedChannelId.set(null);
    lastChannelBySquadId.set({});
    lastHubChannelNameBySquadId.set({});
    squadNavOrder.set([]);
    dashboardPollReplicaNonceByParentId.set({});
    squadAllowlistNonceByParentId.set({});
    squadTrackedTokensNonceByParentId.set({});
    squadBotMetaNonceBySquadId.set({});
    setCurrentNpubForPersistence(null);
    vi.unstubAllGlobals();
  });

  it('has expected initial values', () => {
    expect(get(activeTopNavTab)).toBe('commons');
    expect(get(activeSquadId)).toBeNull();
    expect(get(activeChannelId)).toBeNull();
    expect(get(activeHubChannelName)).toBeNull();
    expect(get(activeView)).toBe('hub');
    expect(get(squadDashboardChannelMode)).toBe('status');
    expect(get(showMembersPanel)).toBe(false);
  });

  it('parses known squad dashboard channel modes', () => {
    expect(parseSquadDashboardChannelMode('status')).toBe('status');
    expect(parseSquadDashboardChannelMode('governance')).toBe('governance');
    expect(parseSquadDashboardChannelMode('roles')).toBe('roles');
    expect(parseSquadDashboardChannelMode('treasury')).toBe('treasury');
    expect(parseSquadDashboardChannelMode('crew')).toBe('crew');
  });

  it('resets unknown squad dashboard modes to status', () => {
    expect(parseSquadDashboardChannelMode(null)).toBe('status');
    expect(parseSquadDashboardChannelMode('')).toBe('status');
    expect(parseSquadDashboardChannelMode('nope')).toBe('status');
    expect(parseSquadDashboardChannelMode('polls')).toBe('status');
    expect(parseSquadDashboardChannelMode('modules')).toBe('status');
  });

  it('persists squad dashboard channel mode under an npub-scoped key', () => {
    setCurrentNpubForPersistence('npub1abc');
    squadDashboardChannelMode.set('treasury');
    expect(storage.get(`${SQUAD_DASHBOARD_MODE_PREFIX}_npub1abc`)).toBe('treasury');
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

  it('persists squad nav order under an npub-scoped key', () => {
    setCurrentNpubForPersistence('npub1abc');
    squadNavOrder.set(['s2', 's1']);
    expect(JSON.parse(storage.get(`${SQUAD_NAV_ORDER_PREFIX}_npub1abc`) ?? '[]')).toEqual(['s2', 's1']);
  });

  it('parseSquadNavOrder treats corrupt storage as empty', () => {
    expect(parseSquadNavOrder('{bad')).toEqual([]);
    expect(parseSquadNavOrder('[1,2]')).toEqual([]);
  });

  it('does not leak squad nav order across accounts', () => {
    setCurrentNpubForPersistence('npub1a');
    squadNavOrder.set(['only-a']);
    expect(JSON.parse(storage.get(`${SQUAD_NAV_ORDER_PREFIX}_npub1a`) ?? '[]')).toEqual(['only-a']);
    setCurrentNpubForPersistence('npub1b');
    squadNavOrder.set(['only-b']);
    expect(JSON.parse(storage.get(`${SQUAD_NAV_ORDER_PREFIX}_npub1b`) ?? '[]')).toEqual(['only-b']);
    expect(JSON.parse(storage.get(`${SQUAD_NAV_ORDER_PREFIX}_npub1a`) ?? '[]')).toEqual(['only-a']);
  });

  it('skips persistence when no npub is set', () => {
    squadDashboardChannelMode.set('crew');
    expect(storage.size).toBe(0);
  });

  it('bumps the dashboard poll replica nonce', () => {
    dashboardPollReplicaNonceByParentId.set({ p1: 1 });
    expect(get(dashboardPollReplicaNonceByParentId)).toEqual({ p1: 1 });
  });
});
