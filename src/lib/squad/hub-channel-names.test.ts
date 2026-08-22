import { describe, expect, it } from 'vitest';
import {
  MY_DASHBOARD_CHANNEL_ID,
  SQUAD_DASHBOARD_CHANNEL_ID,
  SQUAD_WARGAME_CHANNEL_ID,
  isSquadDashboardChromeChannelId,
  isVirtualHubChannelId,
} from './hub-channel-names';

describe('isVirtualHubChannelId', () => {
  it('matches dashboard, my-dashboard, and squad-wargame', () => {
    expect(isVirtualHubChannelId(SQUAD_DASHBOARD_CHANNEL_ID)).toBe(true);
    expect(isVirtualHubChannelId(MY_DASHBOARD_CHANNEL_ID)).toBe(true);
    expect(isVirtualHubChannelId(SQUAD_WARGAME_CHANNEL_ID)).toBe(true);
    expect(isVirtualHubChannelId('g-announcements')).toBe(false);
    expect(isVirtualHubChannelId(null)).toBe(false);
  });
});

describe('isSquadDashboardChromeChannelId', () => {
  it('matches squad-dashboard and squad-wargame only', () => {
    expect(isSquadDashboardChromeChannelId(SQUAD_DASHBOARD_CHANNEL_ID)).toBe(true);
    expect(isSquadDashboardChromeChannelId(SQUAD_WARGAME_CHANNEL_ID)).toBe(true);
    expect(isSquadDashboardChromeChannelId(MY_DASHBOARD_CHANNEL_ID)).toBe(false);
  });
});
