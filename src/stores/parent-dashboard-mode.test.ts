import { describe, expect, it } from 'vitest';
import { parseParentDashboardChannelMode } from './app';

describe('parseParentDashboardChannelMode', () => {
  it('accepts current slugs', () => {
    expect(parseParentDashboardChannelMode('governance')).toBe('governance');
    expect(parseParentDashboardChannelMode('roles_tree')).toBe('roles_tree');
    expect(parseParentDashboardChannelMode('treasury')).toBe('treasury');
    expect(parseParentDashboardChannelMode('settings')).toBe('settings');
  });

  it('resets unknown and legacy stored values to governance', () => {
    expect(parseParentDashboardChannelMode(null)).toBe('governance');
    expect(parseParentDashboardChannelMode('')).toBe('governance');
    expect(parseParentDashboardChannelMode('nope')).toBe('governance');
    expect(parseParentDashboardChannelMode('polls')).toBe('governance');
    expect(parseParentDashboardChannelMode('modules')).toBe('governance');
    expect(parseParentDashboardChannelMode('proposals')).toBe('governance');
    expect(parseParentDashboardChannelMode('structure')).toBe('governance');
    expect(parseParentDashboardChannelMode('permissions')).toBe('governance');
  });
});
