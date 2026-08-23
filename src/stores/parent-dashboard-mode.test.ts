import { describe, expect, it } from 'vitest';
import { parseSquadDashboardChannelMode } from './navigation';

describe('parseSquadDashboardChannelMode', () => {
  it('accepts known modes', () => {
    expect(parseSquadDashboardChannelMode('status')).toBe('status');
    expect(parseSquadDashboardChannelMode('governance')).toBe('governance');
    expect(parseSquadDashboardChannelMode('treasury')).toBe('treasury');
    expect(parseSquadDashboardChannelMode('crew')).toBe('crew');
    expect(parseSquadDashboardChannelMode('settings')).toBe('status');
  });

  it('resets unknown values to status', () => {
    expect(parseSquadDashboardChannelMode(null)).toBe('status');
    expect(parseSquadDashboardChannelMode('')).toBe('status');
    expect(parseSquadDashboardChannelMode('stickers')).toBe('status');
    expect(parseSquadDashboardChannelMode('roles')).toBe('status');
    expect(parseSquadDashboardChannelMode('roles_tree')).toBe('status');
  });
});
