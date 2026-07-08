import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import * as rosterKeyChoice from '../lib/squad/squad-roster-key-choice';
import { JOIN_REQUESTS_CHANNEL_NAME } from '../lib/squad/hub-channel-names';
import {
  hubChannelAlertCount,
  personalAlertsNeededBySquadId,
  refreshPersonalAlertForSquad,
  resetSquadHubAlertStores,
  setPersonalAlertNeeded,
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
    expect(hubChannelAlertCount(JOIN_REQUESTS_CHANNEL_NAME, 'squad1', joinRequests as never)).toBe(2);
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

    const needsSpy = vi.spyOn(rosterKeyChoice, 'needsSquadRosterKeyChoice').mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(true), 20))
    );

    const pending = refreshPersonalAlertForSquad(squad);
    setPersonalAlertNeeded('squad1', false);
    await pending;

    expect(get(personalAlertsNeededBySquadId).squad1).toBe(false);
    needsSpy.mockRestore();
  });
});
