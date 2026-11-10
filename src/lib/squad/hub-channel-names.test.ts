import { describe, expect, it } from 'vitest';
import {
  TOOLS_CHANNEL_NAME,
  SETTINGS_CHANNEL_ID,
  SQUAD_DASHBOARD_CHANNEL_ID,
  SQUAD_WARGAME_CHANNEL_ID,
  toolsModeFromObsoleteHubName,
  isSquadDashboardChromeChannelId,
  isVirtualHubChannelId,
  migrateLastHubChannelNamesBySquad,
  normalizeHubChannelName,
  remapObsoleteHubChannelId,
  defaultGovernanceStackChannelId,
  resolveGovernanceChromeChannelId,
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

describe('defaultGovernanceStackChannelId', () => {
  it('prefers Wargame when live pacto_gov is absent', () => {
    expect(defaultGovernanceStackChannelId(false)).toBe(SQUAD_WARGAME_CHANNEL_ID);
  });

  it('prefers Live when live pacto_gov exists', () => {
    expect(defaultGovernanceStackChannelId(true)).toBe(SQUAD_DASHBOARD_CHANNEL_ID);
  });
});

describe('resolveGovernanceChromeChannelId', () => {
  it('restores last chrome id over the practice-first default', () => {
    expect(resolveGovernanceChromeChannelId(SQUAD_DASHBOARD_CHANNEL_ID, false)).toBe(
      SQUAD_DASHBOARD_CHANNEL_ID,
    );
    expect(resolveGovernanceChromeChannelId(SQUAD_WARGAME_CHANNEL_ID, true)).toBe(
      SQUAD_WARGAME_CHANNEL_ID,
    );
  });

  it('falls back to practice-first default when last is not chrome', () => {
    expect(resolveGovernanceChromeChannelId('g-ops', false)).toBe(SQUAD_WARGAME_CHANNEL_ID);
    expect(resolveGovernanceChromeChannelId(null, true)).toBe(SQUAD_DASHBOARD_CHANNEL_ID);
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
  it('maps legacy shelf names and board slug to tools', () => {
    expect(normalizeHubChannelName('polls')).toBe(TOOLS_CHANNEL_NAME);
    expect(normalizeHubChannelName('events')).toBe(TOOLS_CHANNEL_NAME);
    expect(normalizeHubChannelName('docs')).toBe(TOOLS_CHANNEL_NAME);
    expect(normalizeHubChannelName('board')).toBe(TOOLS_CHANNEL_NAME);
    expect(normalizeHubChannelName('tools')).toBe(TOOLS_CHANNEL_NAME);
    expect(normalizeHubChannelName('announcements')).toBe('announcements');
    expect(normalizeHubChannelName(null)).toBeNull();
  });
});

describe('toolsModeFromObsoleteHubName', () => {
  it('returns the shelf mode for legacy names', () => {
    expect(toolsModeFromObsoleteHubName('polls')).toBe('polls');
    expect(toolsModeFromObsoleteHubName('events')).toBe('events');
    expect(toolsModeFromObsoleteHubName('docs')).toBe('docs');
    expect(toolsModeFromObsoleteHubName('board')).toBeNull();
    expect(toolsModeFromObsoleteHubName('tools')).toBeNull();
    expect(toolsModeFromObsoleteHubName(null)).toBeNull();
  });
});

describe('migrateLastHubChannelNamesBySquad', () => {
  it('normalizes shelves to tools and captures events mode for the last-opened squad', () => {
    expect(
      migrateLastHubChannelNamesBySquad(
        { 'squad-a': 'announcements', 'squad-b': 'events' },
        'squad-b',
      ),
    ).toEqual({
      hubs: { 'squad-a': 'announcements', 'squad-b': TOOLS_CHANNEL_NAME },
      toolsModeFromLegacy: 'events',
    });
  });

  it('captures docs mode for the last-opened squad', () => {
    expect(migrateLastHubChannelNamesBySquad({ 'squad-a': 'docs' }, 'squad-a')).toEqual({
      hubs: { 'squad-a': TOOLS_CHANNEL_NAME },
      toolsModeFromLegacy: 'docs',
    });
  });

  it('does not capture mode when last-opened squad was not a shelf', () => {
    expect(
      migrateLastHubChannelNamesBySquad(
        { 'squad-a': 'events', 'squad-b': 'announcements' },
        'squad-b',
      ),
    ).toEqual({
      hubs: { 'squad-a': TOOLS_CHANNEL_NAME, 'squad-b': 'announcements' },
      toolsModeFromLegacy: null,
    });
  });
});
