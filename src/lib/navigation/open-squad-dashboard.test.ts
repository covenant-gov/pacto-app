import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  activeTopNavTab,
  activeSquadId,
  activeChannelId,
  activeHubChannelName,
  activeView,
  activeDmId,
  lastOpenedSquadId,
  lastOpenedChannelId,
  lastChannelBySquadId,
  lastHubChannelNameBySquadId,
  settingsChannelMode,
  squadBoardChannelMode,
  squads,
  SQUAD_DASHBOARD_CHANNEL_ID,
  SQUAD_WARGAME_CHANNEL_ID,
  SETTINGS_CHANNEL_ID,
  type Squad,
} from '../../stores/app';
import {
  openSquadDashboard,
  openSquadSettings,
  openSquadWargame,
  navigateToTarget,
  parseEventReminderSourceId,
  resolveCatchUpTarget,
} from './open-squad-dashboard';

const mocks = vi.hoisted(() => ({
  eventsFocusSet: vi.fn(),
}));
vi.mock('../../stores/events-navigation', () => ({
  eventsFocus: { set: mocks.eventsFocusSet },
  focusSquadEvent: vi.fn(),
  focusSquadEventSeries: vi.fn(),
}));

function squad(id: string, channels: { name: string; groupId: string }[]): Squad {
  return {
    id,
    name: id,
    channels: channels.map((c, i) => ({ ...c, order: i })),
    kind: 'squad',
    createdAt: 0,
    updatedAt: 0,
  } as Squad;
}

describe('openSquadDashboard', () => {
  beforeEach(() => {
    activeTopNavTab.set('commons');
    activeSquadId.set(null);
    activeChannelId.set(null);
    activeHubChannelName.set(null);
    activeView.set('hub');
    activeDmId.set(null);
    lastOpenedSquadId.set(null);
    lastOpenedChannelId.set(null);
    lastChannelBySquadId.set({});
    lastHubChannelNameBySquadId.set({});
    squads.set([]);
  });

  it('sets active tab, squad, dashboard channel, and view', () => {
    openSquadDashboard('squad-123');
    expect(get(activeTopNavTab)).toBe('squads');
    expect(get(activeSquadId)).toBe('squad-123');
    expect(get(activeChannelId)).toBe(SQUAD_DASHBOARD_CHANNEL_ID);
    expect(get(activeView)).toBe('hub');
  });

  it('trims whitespace from parent id', () => {
    openSquadDashboard('  squad-456  ');
    expect(get(activeSquadId)).toBe('squad-456');
  });

  it('does nothing when id is empty', () => {
    openSquadDashboard('');
    expect(get(activeTopNavTab)).toBe('commons');
    expect(get(activeSquadId)).toBeNull();
  });

  it('does nothing when id is whitespace-only', () => {
    openSquadDashboard('   ');
    expect(get(activeTopNavTab)).toBe('commons');
    expect(get(activeSquadId)).toBeNull();
  });
});

describe('openSquadWargame', () => {
  beforeEach(() => {
    activeTopNavTab.set('commons');
    activeSquadId.set(null);
    activeChannelId.set(null);
    activeHubChannelName.set(null);
    activeView.set('hub');
    lastOpenedSquadId.set(null);
    lastOpenedChannelId.set(null);
    lastChannelBySquadId.set({});
    lastHubChannelNameBySquadId.set({});
    squads.set([]);
  });

  it('sets active tab, squad, and squad-wargame channel', () => {
    openSquadWargame('squad-123');
    expect(get(activeTopNavTab)).toBe('squads');
    expect(get(activeSquadId)).toBe('squad-123');
    expect(get(activeChannelId)).toBe(SQUAD_WARGAME_CHANNEL_ID);
    expect(get(activeHubChannelName)).toBeNull();
    expect(get(activeView)).toBe('hub');
  });

  it('does nothing when id is empty', () => {
    openSquadWargame('   ');
    expect(get(activeTopNavTab)).toBe('commons');
    expect(get(activeSquadId)).toBeNull();
  });
});

describe('openSquadSettings', () => {
  beforeEach(() => {
    activeTopNavTab.set('commons');
    activeSquadId.set(null);
    activeChannelId.set(null);
    activeHubChannelName.set(null);
    activeView.set('hub');
    lastOpenedSquadId.set(null);
    lastOpenedChannelId.set(null);
    lastChannelBySquadId.set({});
    lastHubChannelNameBySquadId.set({});
    settingsChannelMode.set('you');
    squads.set([]);
  });

  it('opens #settings in access mode', () => {
    openSquadSettings('squad-123');
    expect(get(activeTopNavTab)).toBe('squads');
    expect(get(activeSquadId)).toBe('squad-123');
    expect(get(activeChannelId)).toBe(SETTINGS_CHANNEL_ID);
    expect(get(settingsChannelMode)).toBe('access');
    expect(get(activeView)).toBe('hub');
  });

  it('does nothing when id is empty', () => {
    openSquadSettings('   ');
    expect(get(activeTopNavTab)).toBe('commons');
    expect(get(activeSquadId)).toBeNull();
    expect(get(settingsChannelMode)).toBe('you');
  });
});

describe('navigateToTarget', () => {
  beforeEach(() => {
    activeTopNavTab.set('commons');
    activeSquadId.set(null);
    activeChannelId.set(null);
    activeHubChannelName.set(null);
    activeView.set('hub');
    activeDmId.set(null);
    lastOpenedSquadId.set(null);
    lastOpenedChannelId.set(null);
    lastChannelBySquadId.set({});
    lastHubChannelNameBySquadId.set({});
    settingsChannelMode.set('you');
    squads.set([
      squad('squad-1', [
        { name: 'announcements', groupId: 'grp-announce' },
        { name: 'board', groupId: 'grp-announce' },
        { name: 'ops', groupId: 'grp-ops' },
      ]),
    ]);
  });

  it('a squad-channel target sets navigation and memory state, matching the toast handler shape', () => {
    navigateToTarget({ kind: 'squad-channel', squadId: 'squad-1', channelId: 'grp-ops' });
    expect(get(activeTopNavTab)).toBe('squads');
    expect(get(activeSquadId)).toBe('squad-1');
    expect(get(activeChannelId)).toBe('grp-ops');
    expect(get(activeView)).toBe('hub');
    expect(get(lastOpenedSquadId)).toBe('squad-1');
    expect(get(lastOpenedChannelId)).toBe('grp-ops');
    expect(get(lastChannelBySquadId)).toEqual({ 'squad-1': 'grp-ops' });
    expect(get(activeHubChannelName)).toBe('ops');
    expect(get(lastHubChannelNameBySquadId)).toEqual({ 'squad-1': 'ops' });
  });

  it('a squad-dashboard target opens the virtual dashboard channel with no hub channel name', () => {
    navigateToTarget({ kind: 'squad-dashboard', squadId: 'squad-1' });
    expect(get(activeChannelId)).toBe(SQUAD_DASHBOARD_CHANNEL_ID);
    expect(get(activeHubChannelName)).toBeNull();
  });

  it('a dm target sets activeDmId and switches to the dms tab', () => {
    navigateToTarget({ kind: 'dm', npub: 'npub1peer' });
    expect(get(activeDmId)).toBe('npub1peer');
    expect(get(activeTopNavTab)).toBe('dms');
    expect(get(activeView)).toBe('hub');
  });

  it('a #settings channel target without settingsMode keeps the current pane', () => {
    navigateToTarget({ kind: 'squad-channel', squadId: 'squad-1', channelId: SETTINGS_CHANNEL_ID });
    expect(get(activeChannelId)).toBe(SETTINGS_CHANNEL_ID);
    expect(get(settingsChannelMode)).toBe('you');
  });

  it('a #settings channel target with settingsMode selects that pane', () => {
    navigateToTarget({
      kind: 'squad-channel',
      squadId: 'squad-1',
      channelId: SETTINGS_CHANNEL_ID,
      settingsMode: 'network',
    });
    expect(get(activeChannelId)).toBe(SETTINGS_CHANNEL_ID);
    expect(get(settingsChannelMode)).toBe('network');
  });

  it('a squad-event target opens #board events mode for that event', () => {
    mocks.eventsFocusSet.mockReset();
    navigateToTarget({
      kind: 'squad-event',
      squadId: 'squad-1',
      channelId: 'grp-announce',
      hubChannelName: 'events',
      eventId: 'evt-1',
    });
    expect(mocks.eventsFocusSet).toHaveBeenCalledWith({
      parentId: 'squad-1',
      eventId: 'evt-1',
      seriesId: null,
    });
    expect(get(activeChannelId)).toBe('grp-announce');
    expect(get(activeHubChannelName)).toBe('board');
    expect(get(squadBoardChannelMode)).toBe('events');
  });
});

describe('resolveCatchUpTarget', () => {
  const testSquads = [
    squad('squad-1', [
      { name: 'announcements', groupId: 'grp-announce' },
      { name: 'board', groupId: 'grp-announce' },
      { name: 'ops', groupId: 'grp-ops' },
    ]),
  ];

  it('resolves a mention entry to its squad channel', () => {
    const target = resolveCatchUpTarget({ chatId: 'grp-ops', kind: 'mention' }, testSquads);
    expect(target).toEqual({ kind: 'squad-channel', squadId: 'squad-1', channelId: 'grp-ops' });
  });

  it('resolves an action_prompt entry on the announcements channel to the squad dashboard', () => {
    const target = resolveCatchUpTarget({ chatId: 'grp-announce', kind: 'action_prompt' }, testSquads);
    expect(target).toEqual({ kind: 'squad-dashboard', squadId: 'squad-1' });
  });

  it('resolves a join-request action_prompt to #settings Access', () => {
    const target = resolveCatchUpTarget(
      { chatId: 'grp-announce', kind: 'action_prompt', sourceEventId: 'join-request:evt-1' },
      testSquads,
    );
    expect(target).toEqual({
      kind: 'squad-channel',
      squadId: 'squad-1',
      channelId: SETTINGS_CHANNEL_ID,
      settingsMode: 'access',
    });
  });

  it('resolves an action_prompt entry on a non-announcements channel to that channel directly', () => {
    const target = resolveCatchUpTarget({ chatId: 'grp-ops', kind: 'action_prompt' }, testSquads);
    expect(target).toEqual({ kind: 'squad-channel', squadId: 'squad-1', channelId: 'grp-ops' });
  });

  it('resolves an npub chat id with no matching squad channel to a dm target', () => {
    const target = resolveCatchUpTarget({ chatId: 'npub1peer', kind: 'direct_message' }, testSquads);
    expect(target).toEqual({ kind: 'dm', npub: 'npub1peer' });
  });

  it('returns null for a chat id that resolves to neither a squad channel nor an npub', () => {
    const target = resolveCatchUpTarget({ chatId: 'orphaned-id', kind: 'mention' }, testSquads);
    expect(target).toBeNull();
  });

  it('resolves an event_reminder entry to the events channel and that event, not the dashboard', () => {
    const target = resolveCatchUpTarget(
      { chatId: 'grp-announce', kind: 'event_reminder', sourceEventId: 'evt-1:1767224700000' },
      testSquads,
    );
    expect(target).toEqual({
      kind: 'squad-event',
      squadId: 'squad-1',
      channelId: 'grp-announce',
      hubChannelName: 'events',
      eventId: 'evt-1',
    });
  });

  it('returns null for an event_reminder with a malformed source id', () => {
    expect(
      resolveCatchUpTarget({ chatId: 'grp-announce', kind: 'event_reminder', sourceEventId: 'evt-1' }, testSquads),
    ).toBeNull();
  });
});

describe('parseEventReminderSourceId', () => {
  it('splits on the last colon so event ids may contain colons', () => {
    expect(parseEventReminderSourceId('a:b:1767224700000')).toEqual({ eventId: 'a:b', fireAtMs: 1_767_224_700_000 });
  });

  it('rejects a missing event id or a non-numeric fire time', () => {
    expect(parseEventReminderSourceId(':123')).toBeNull();
    expect(parseEventReminderSourceId('evt-1:soon')).toBeNull();
    expect(parseEventReminderSourceId('evt-1:')).toBeNull();
  });
});
