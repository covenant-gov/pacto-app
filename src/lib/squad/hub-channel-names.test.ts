import { describe, expect, it } from 'vitest';
import {
  BOARD_CHANNEL_NAME,
  SETTINGS_CHANNEL_ID,
  SQUAD_DASHBOARD_CHANNEL_ID,
  SQUAD_WARGAME_CHANNEL_ID,
  boardModeFromObsoleteHubName,
  isSquadDashboardChromeChannelId,
  isVirtualHubChannelId,
  normalizeHubChannelName,
  remapObsoleteHubChannelId,
} from './hub-channel-names';

describe('isVirtualHubChannelId', () => {
  it('matches governance, gov-practice, and settings', () => {
    expect(isVirtualHubChannelId(SQUAD_DASHBOARD_CHANNEL_ID)).toBe(true);
    expect(isVirtualHubChannelId(SQUAD_WARGAME_CHANNEL_ID)).toBe(true);
    expect(isVirtualHubChannelId(SETTINGS_CHANNEL_ID)).toBe(true);
    expect(isVirtualHubChannelId('__my_dashboard__')).toBe(false);
    expect(isVirtualHubChannelId('__squad_dashboard__')).toBe(false);
    expect(isVirtualHubChannelId('g-announcements')).toBe(false);
    expect(isVirtualHubChannelId(null)).toBe(false);
  });
});

describe('isSquadDashboardChromeChannelId', () => {
  it('matches governance and gov-practice only', () => {
    expect(isSquadDashboardChromeChannelId(SQUAD_DASHBOARD_CHANNEL_ID)).toBe(true);
    expect(isSquadDashboardChromeChannelId(SQUAD_WARGAME_CHANNEL_ID)).toBe(true);
    expect(isSquadDashboardChromeChannelId(SETTINGS_CHANNEL_ID)).toBe(false);
    expect(isSquadDashboardChromeChannelId('__my_dashboard__')).toBe(false);
  });
});

describe('remapObsoleteHubChannelId', () => {
  it('remaps obsolete virtual ids to settings / governance / gov-practice', () => {
    expect(remapObsoleteHubChannelId('__my_dashboard__')).toBe(SETTINGS_CHANNEL_ID);
    expect(remapObsoleteHubChannelId('__squad_dashboard__')).toBe(SQUAD_DASHBOARD_CHANNEL_ID);
    expect(remapObsoleteHubChannelId('__squad_wargame__')).toBe(SQUAD_WARGAME_CHANNEL_ID);
    expect(remapObsoleteHubChannelId(SETTINGS_CHANNEL_ID)).toBe(SETTINGS_CHANNEL_ID);
    expect(remapObsoleteHubChannelId(null)).toBeNull();
  });
});

describe('normalizeHubChannelName', () => {
  it('maps legacy shelf names to board', () => {
    expect(normalizeHubChannelName('polls')).toBe(BOARD_CHANNEL_NAME);
    expect(normalizeHubChannelName('events')).toBe(BOARD_CHANNEL_NAME);
    expect(normalizeHubChannelName('docs')).toBe(BOARD_CHANNEL_NAME);
    expect(normalizeHubChannelName('board')).toBe(BOARD_CHANNEL_NAME);
    expect(normalizeHubChannelName('announcements')).toBe('announcements');
    expect(normalizeHubChannelName(null)).toBeNull();
  });
});

describe('boardModeFromObsoleteHubName', () => {
  it('returns the shelf mode for legacy names', () => {
    expect(boardModeFromObsoleteHubName('polls')).toBe('polls');
    expect(boardModeFromObsoleteHubName('events')).toBe('events');
    expect(boardModeFromObsoleteHubName('docs')).toBe('docs');
    expect(boardModeFromObsoleteHubName('board')).toBeNull();
    expect(boardModeFromObsoleteHubName(null)).toBeNull();
  });
});
