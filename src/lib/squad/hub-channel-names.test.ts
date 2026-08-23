import { describe, expect, it } from 'vitest';
import {
  SETTINGS_CHANNEL_ID,
  SQUAD_DASHBOARD_CHANNEL_ID,
  SQUAD_WARGAME_CHANNEL_ID,
  isSquadDashboardChromeChannelId,
  isVirtualHubChannelId,
  remapObsoleteHubChannelId,
} from './hub-channel-names';

describe('isVirtualHubChannelId', () => {
  it('matches dashboard, squad-wargame, and settings', () => {
    expect(isVirtualHubChannelId(SQUAD_DASHBOARD_CHANNEL_ID)).toBe(true);
    expect(isVirtualHubChannelId(SQUAD_WARGAME_CHANNEL_ID)).toBe(true);
    expect(isVirtualHubChannelId(SETTINGS_CHANNEL_ID)).toBe(true);
    expect(isVirtualHubChannelId('__my_dashboard__')).toBe(false);
    expect(isVirtualHubChannelId('g-announcements')).toBe(false);
    expect(isVirtualHubChannelId(null)).toBe(false);
  });
});

describe('isSquadDashboardChromeChannelId', () => {
  it('matches squad-dashboard and squad-wargame only', () => {
    expect(isSquadDashboardChromeChannelId(SQUAD_DASHBOARD_CHANNEL_ID)).toBe(true);
    expect(isSquadDashboardChromeChannelId(SQUAD_WARGAME_CHANNEL_ID)).toBe(true);
    expect(isSquadDashboardChromeChannelId(SETTINGS_CHANNEL_ID)).toBe(false);
    expect(isSquadDashboardChromeChannelId('__my_dashboard__')).toBe(false);
  });
});

describe('remapObsoleteHubChannelId', () => {
  it('remaps the obsolete my-dashboard id to settings', () => {
    expect(remapObsoleteHubChannelId('__my_dashboard__')).toBe(SETTINGS_CHANNEL_ID);
    expect(remapObsoleteHubChannelId(SETTINGS_CHANNEL_ID)).toBe(SETTINGS_CHANNEL_ID);
    expect(remapObsoleteHubChannelId(null)).toBeNull();
  });
});
