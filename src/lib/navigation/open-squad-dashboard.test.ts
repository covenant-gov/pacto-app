import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  activeTopNavTab,
  activeSquadId,
  activeChannelId,
  activeView,
  DASHBOARD_CHANNEL_ID,
} from '../../stores/app';
import { openSquadDashboard } from './open-squad-dashboard';

vi.mock('../../stores/app', () => ({
  activeTopNavTab: { set: vi.fn() },
  activeSquadId: { set: vi.fn() },
  activeChannelId: { set: vi.fn() },
  activeView: { set: vi.fn() },
  DASHBOARD_CHANNEL_ID: '#dashboard',
}));

describe('openSquadDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets active tab, squad, dashboard channel, and view', () => {
    openSquadDashboard('squad-123');
    expect(activeTopNavTab.set).toHaveBeenCalledWith('squads');
    expect(activeSquadId.set).toHaveBeenCalledWith('squad-123');
    expect(activeChannelId.set).toHaveBeenCalledWith(DASHBOARD_CHANNEL_ID);
    expect(activeView.set).toHaveBeenCalledWith('hub');
  });

  it('trims whitespace from parent id', () => {
    openSquadDashboard('  squad-456  ');
    expect(activeSquadId.set).toHaveBeenCalledWith('squad-456');
  });

  it('does nothing when id is empty', () => {
    openSquadDashboard('');
    expect(activeTopNavTab.set).not.toHaveBeenCalled();
    expect(activeSquadId.set).not.toHaveBeenCalled();
    expect(activeChannelId.set).not.toHaveBeenCalled();
    expect(activeView.set).not.toHaveBeenCalled();
  });

  it('does nothing when id is whitespace-only', () => {
    openSquadDashboard('   ');
    expect(activeTopNavTab.set).not.toHaveBeenCalled();
    expect(activeSquadId.set).not.toHaveBeenCalled();
    expect(activeChannelId.set).not.toHaveBeenCalled();
    expect(activeView.set).not.toHaveBeenCalled();
  });
});
