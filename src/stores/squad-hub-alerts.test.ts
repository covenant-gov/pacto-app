import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import * as rosterKeyChoice from '../lib/squad/squad-roster-key-choice';

const mockResolveCatchUpEntry = vi.hoisted(() => vi.fn());
const mockGetCatchUpCount = vi.hoisted(() => vi.fn());
const mockRecordActionNeededEntry = vi.hoisted(() => vi.fn());

vi.mock('../lib/api/catch-up', () => ({
  resolveCatchUpEntry: (...args: unknown[]) => mockResolveCatchUpEntry(...args),
  getCatchUpCount: (...args: unknown[]) => mockGetCatchUpCount(...args),
  recordActionNeededEntry: (...args: unknown[]) => mockRecordActionNeededEntry(...args),
  listCatchUpEntries: vi.fn(),
  resolveAllCatchUpEntries: vi.fn(),
}));

import {
  personalAlertsNeededBySquadId,
  refreshPersonalAlertForSquad,
  resetSquadHubAlertStores,
  setPersonalAlertNeeded,
  mentionsBySquadChannel,
  incrementMentionAlert,
  clearMentionAlert,
} from './squad-hub-alerts';
import { catchUpCount, resetCatchUpStore } from './catch-up';
import type { Squad } from './squads';

describe('squad hub channel alerts', () => {
  beforeEach(() => {
    resetSquadHubAlertStores();
    resetCatchUpStore();
    mockResolveCatchUpEntry.mockReset().mockResolvedValue(true);
    mockGetCatchUpCount.mockReset().mockResolvedValue(0);
    mockRecordActionNeededEntry.mockReset().mockResolvedValue(undefined);
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

  it('refreshPersonalAlertForSquad refreshes catchUpCount when roster-key prompt clears', async () => {
    const squad = {
      id: 'squad1',
      name: 'Test',
      channels: [{ name: 'announcements', groupId: 'grp-1', order: 0 }],
    } as Squad;
    catchUpCount.set(3);
    mockGetCatchUpCount.mockResolvedValueOnce(2);
    vi.spyOn(rosterKeyChoice, 'needsSquadRosterKeyChoice').mockResolvedValue(false);

    await refreshPersonalAlertForSquad(squad);
    await vi.waitFor(() => {
      expect(mockResolveCatchUpEntry).toHaveBeenCalledWith('roster-key:squad1');
      expect(get(catchUpCount)).toBe(2);
    });
  });

  it('refreshPersonalAlertForSquad records and hydrates count when roster-key is needed', async () => {
    const squad = {
      id: 'squad1',
      name: 'Test',
      channels: [{ name: 'announcements', groupId: 'grp-1', order: 0 }],
    } as Squad;
    catchUpCount.set(0);
    mockGetCatchUpCount.mockResolvedValueOnce(1);
    vi.spyOn(rosterKeyChoice, 'needsSquadRosterKeyChoice').mockResolvedValue(true);

    await refreshPersonalAlertForSquad(squad);
    await vi.waitFor(() => {
      expect(mockRecordActionNeededEntry).toHaveBeenCalledWith('grp-1', 'roster-key:squad1');
      expect(get(catchUpCount)).toBe(1);
    });
  });

  it('mention alert increments count for the correct squad and channel', () => {
    incrementMentionAlert('squad1', 'general');
    expect(get(mentionsBySquadChannel)['squad1:general']).toBe(1);
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
