import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  activeSquadId,
  activeChannelId,
  activeHubChannelName,
  lastChannelBySquadId,
  lastHubChannelNameBySquadId,
  lastOpenedChannelId,
  lastOpenedSquadId,
} from '../../stores/navigation';
import { channelDefaultsFromSquad, remapActiveSquadNavigation } from './squad-navigation';
import type { Squad } from '../../stores/squads';

const finalized: Squad = {
  id: 'grp-real',
  name: 'Alpha',
  channels: [
    { name: 'announcements', groupId: 'grp-real', order: 0 },
    { name: 'polls', groupId: 'grp-real', order: 1 },
  ],
  kind: 'squad',
  createdAt: 1,
  updatedAt: 2,
};

describe('channelDefaultsFromSquad', () => {
  it('prefers announcements row for channel and hub name', () => {
    expect(channelDefaultsFromSquad(finalized)).toEqual({
      channelId: 'grp-real',
      hubChannelName: 'announcements',
    });
  });
});

describe('remapActiveSquadNavigation', () => {
  beforeEach(() => {
    activeSquadId.set('creating-squad-1');
    activeChannelId.set(null);
    activeHubChannelName.set(null);
    lastOpenedSquadId.set('creating-squad-1');
    lastOpenedChannelId.set(null);
    lastChannelBySquadId.set({ 'creating-squad-1': 'creating-squad-1' });
    lastHubChannelNameBySquadId.set({});
  });

  afterEach(() => {
    activeSquadId.set(null);
    activeChannelId.set(null);
    activeHubChannelName.set(null);
    lastOpenedSquadId.set(null);
    lastOpenedChannelId.set(null);
    lastChannelBySquadId.set({});
    lastHubChannelNameBySquadId.set({});
  });

  it('remaps active selection and persisted prefs from temp id to final id', () => {
    remapActiveSquadNavigation('creating-squad-1', 'grp-real', channelDefaultsFromSquad(finalized));

    expect(get(activeSquadId)).toBe('grp-real');
    expect(get(activeChannelId)).toBe('grp-real');
    expect(get(activeHubChannelName)).toBe('announcements');
    expect(get(lastOpenedSquadId)).toBe('grp-real');
    expect(get(lastOpenedChannelId)).toBe('grp-real');
    expect(get(lastChannelBySquadId)).toEqual({ 'grp-real': 'grp-real' });
    expect(get(lastHubChannelNameBySquadId)).toEqual({ 'grp-real': 'announcements' });
  });

  it('leaves active selection alone when user switched squads during create', () => {
    activeSquadId.set('other-squad');
    activeChannelId.set('other-channel');

    remapActiveSquadNavigation('creating-squad-1', 'grp-real', channelDefaultsFromSquad(finalized));

    expect(get(activeSquadId)).toBe('other-squad');
    expect(get(activeChannelId)).toBe('other-channel');
    expect(get(lastOpenedSquadId)).toBe('grp-real');
    expect(get(lastChannelBySquadId)['grp-real']).toBe('grp-real');
  });
});
