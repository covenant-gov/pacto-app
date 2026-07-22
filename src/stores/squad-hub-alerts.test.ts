import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import * as rosterKeyChoice from '../lib/squad/squad-roster-key-choice';
import { SQUAD_DASHBOARD_CHANNEL_NAME } from '../lib/squad/hub-channel-names';
import {
  hubChannelAlertCount,
  personalAlertsNeededBySquadId,
  refreshPersonalAlertForSquad,
  resetSquadHubAlertStores,
  setPersonalAlertNeeded,
  mentionsBySquadChannel,
  incrementMentionAlert,
  clearMentionAlert,
} from './squad-hub-alerts';
import type { Squad } from './squads';

describe('squad hub channel alerts', () => {
  beforeEach(() => {
    resetSquadHubAlertStores();
  });

  it('join-requests badge shows squad-wide pending count', () => {
    const joinRequests = {
      squad1: [{ eventId: 'a' }, { eventId: 'b' }],
    };
    expect(hubChannelAlertCount(SQUAD_DASHBOARD_CHANNEL_NAME, 'squad1', joinRequests as never)).toBe(2);
  });

  it('personal alert flag is independent per squad', () => {
    personalAlertsNeededBySquadId.set({ a: true, b: false });
    expect(get(personalAlertsNeededBySquadId).a).toBe(true);
    expect(get(personalAlertsNeededBySquadId).b).toBe(false);
  });

  it('setPersonalAlertNeeded(false) clears badge immediately', () => {
    personalAlertsNeededBySquadId.set({ squad1: true });
    setPersonalAlertNeeded('squad1', false);
    expect(get(personalAlertsNeededBySquadId).squad1).toBe(false);
  });

  it('stale refreshPersonalAlertForSquad cannot restore cleared badge', async () => {
    const squad = {
      id: 'squad1',
      name: 'Test',
      channels: [{ name: 'announcements', groupId: 'grp-1', order: 0 }],
    } as Squad;
    personalAlertsNeededBySquadId.set({ squad1: true });

    let resolveNeeds: (value: boolean) => void = () => {};
    const needsPromise = new Promise<boolean>((resolve) => {
      resolveNeeds = resolve;
    });
    const needsSpy = vi
      .spyOn(rosterKeyChoice, 'needsSquadRosterKeyChoice')
      .mockImplementation(() => needsPromise);

    const pending = refreshPersonalAlertForSquad(squad);
    setPersonalAlertNeeded('squad1', false);
    resolveNeeds(true);
    await pending;

    expect(get(personalAlertsNeededBySquadId).squad1).toBe(false);
    needsSpy.mockRestore();
  });

  it('stale refreshPersonalAlertForSquad cannot overwrite optimistic set', async () => {
    const squad = {
      id: 'squad1',
      name: 'Test',
      channels: [{ name: 'announcements', groupId: 'grp-1', order: 0 }],
    } as Squad;
    personalAlertsNeededBySquadId.set({ squad1: false });

    let resolveNeeds: (value: boolean) => void = () => {};
    const needsPromise = new Promise<boolean>((resolve) => {
      resolveNeeds = resolve;
    });
    const needsSpy = vi
      .spyOn(rosterKeyChoice, 'needsSquadRosterKeyChoice')
      .mockImplementation(() => needsPromise);

    const pending = refreshPersonalAlertForSquad(squad);
    setPersonalAlertNeeded('squad1', true);
    resolveNeeds(false);
    await pending;

    expect(get(personalAlertsNeededBySquadId).squad1).toBe(true);
    needsSpy.mockRestore();
  });

  it('mention alert increments count for the correct squad and channel', () => {
    incrementMentionAlert('squad1', 'general');
    expect(get(mentionsBySquadChannel)['squad1:general']).toBe(1);
  });

  it('mention alert count combines with join request count on dashboard', () => {
    const joinRequests = { squad1: [{ eventId: 'a' }] };
    incrementMentionAlert('squad1', SQUAD_DASHBOARD_CHANNEL_NAME);
    expect(
      hubChannelAlertCount(
        SQUAD_DASHBOARD_CHANNEL_NAME,
        'squad1',
        joinRequests as never,
        {},
        get(mentionsBySquadChannel)
      )
    ).toBe(2);
  });

  it('clearMentionAlert resets the count for a channel', () => {
    incrementMentionAlert('squad1', 'general');
    clearMentionAlert('squad1', 'general');
    expect(get(mentionsBySquadChannel)['squad1:general']).toBe(0);
  });

  it('clearMentionAlert leaves other channel badges intact', () => {
    incrementMentionAlert('squad1', 'general');
    incrementMentionAlert('squad1', 'random');
    clearMentionAlert('squad1', 'general');
    expect(get(mentionsBySquadChannel)['squad1:general']).toBe(0);
    expect(get(mentionsBySquadChannel)['squad1:random']).toBe(1);
  });

  it('clearing a badge in one squad does not restore it for another squad', () => {
    incrementMentionAlert('squad1', 'general');
    clearMentionAlert('squad1', 'general');
    incrementMentionAlert('squad2', 'general');
    expect(get(mentionsBySquadChannel)['squad1:general']).toBe(0);
    expect(get(mentionsBySquadChannel)['squad2:general']).toBe(1);
  });

  it('resetSquadHubAlertStores clears mention counts', () => {
    incrementMentionAlert('squad1', 'general');
    resetSquadHubAlertStores();
    expect(get(mentionsBySquadChannel)).toEqual({});
  });
});
