import { describe, expect, it } from 'vitest';
import {
  hubDashboardKeepAliveKey,
  rememberHubDashboard,
  retainHubDashboardsForParent,
} from './hub-dashboard-keep-alive';

describe('hub dashboard keep-alive', () => {
  it('keys production and war-game hubs separately', () => {
    expect(hubDashboardKeepAliveKey('squad-a', false)).toBe('squad-a:dashboard');
    expect(hubDashboardKeepAliveKey('squad-a', true)).toBe('squad-a:wargame');
  });

  it('remembers both stacks for one squad and drops another squad', () => {
    const first = rememberHubDashboard([], 'squad-a', true);
    const both = rememberHubDashboard(first, 'squad-a', false);
    expect(both.map((h) => h.key)).toEqual(['squad-a:wargame', 'squad-a:dashboard']);
    expect(rememberHubDashboard(both, 'squad-b', true).map((h) => h.key)).toEqual([
      'squad-b:wargame',
    ]);
  });

  it('retains only the current squad when leaving the hub channel', () => {
    const visited = [
      { key: 'squad-a:wargame', parentId: 'squad-a', warGameStack: true },
      { key: 'squad-b:dashboard', parentId: 'squad-b', warGameStack: false },
    ];
    expect(retainHubDashboardsForParent(visited, 'squad-a').map((h) => h.key)).toEqual([
      'squad-a:wargame',
    ]);
    expect(retainHubDashboardsForParent(visited, '')).toEqual([]);
  });
});
