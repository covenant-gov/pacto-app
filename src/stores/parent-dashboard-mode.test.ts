import { describe, expect, it } from 'vitest';
import {
  parseSquadDashboardChannelMode,
  parseMyDashboardChannelMode,
} from './navigation';

describe('parseSquadDashboardChannelMode', () => {
  it('accepts known modes', () => {
    expect(parseSquadDashboardChannelMode('status')).toBe('status');
    expect(parseSquadDashboardChannelMode('governance')).toBe('governance');
    expect(parseSquadDashboardChannelMode('treasury')).toBe('treasury');
    expect(parseSquadDashboardChannelMode('roles')).toBe('roles');
    expect(parseSquadDashboardChannelMode('crew')).toBe('crew');
    expect(parseSquadDashboardChannelMode('settings')).toBe('settings');
  });

  it('resets unknown values to status', () => {
    expect(parseSquadDashboardChannelMode(null)).toBe('status');
    expect(parseSquadDashboardChannelMode('')).toBe('status');
    expect(parseSquadDashboardChannelMode('stickers')).toBe('status');
    expect(parseSquadDashboardChannelMode('roles_tree')).toBe('status');
  });
});

describe('parseMyDashboardChannelMode', () => {
  it('accepts known modes', () => {
    expect(parseMyDashboardChannelMode('status')).toBe('status');
    expect(parseMyDashboardChannelMode('alerts')).toBe('alerts');
  });

  it('resets unknown values to status', () => {
    expect(parseMyDashboardChannelMode(null)).toBe('status');
    expect(parseMyDashboardChannelMode('nope')).toBe('status');
  });
});
