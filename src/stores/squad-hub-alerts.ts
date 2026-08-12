import { writable } from 'svelte/store';
import { needsSquadRosterKeyChoice } from '../lib/squad/squad-roster-key-choice';
import { ANNOUNCEMENTS_CHANNEL_NAME } from '../lib/squad/hub-channel-names';
import { recordActionNeededEntry } from '../lib/api/catch-up';
import { hydrateCatchUpCount, resolveOneCatchUpEntry } from './catch-up';
import type { Squad } from './squads';

/** Per-user action needed in my-dashboard alerts (roster signer prompt). */
export const personalAlertsNeededBySquadId = writable<Record<string, boolean>>({});

/** Per-channel mention alerts keyed by `${squadId}:${channelName}`. */
export const mentionsBySquadChannel = writable<Record<string, number>>({});

const personalAlertRefreshGenBySquadId = new Map<string, number>();

export function resetSquadHubAlertStores(): void {
  personalAlertsNeededBySquadId.set({});
  personalAlertRefreshGenBySquadId.clear();
  mentionsBySquadChannel.set({});
}

function squadChannelAlertKey(squadId: string, channelName: string): string | null {
  const sid = squadId?.trim();
  const name = channelName?.trim();
  if (!sid || !name) return null;
  return `${sid}:${name}`;
}

export function incrementMentionAlert(squadId: string, channelName: string): void {
  const key = squadChannelAlertKey(squadId, channelName);
  if (!key) return;
  mentionsBySquadChannel.update((m) => ({ ...m, [key]: (m[key] ?? 0) + 1 }));
}

export function clearMentionAlert(squadId: string, channelName: string): void {
  const key = squadChannelAlertKey(squadId, channelName);
  if (!key) return;
  mentionsBySquadChannel.update((m) => ({ ...m, [key]: 0 }));
}

export function announcementsGroupIdForSquad(squad: Squad): string | null {
  return (
    squad.channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.groupId?.trim() ||
    squad.channels[0]?.groupId?.trim() ||
    null
  );
}

/** Optimistic clear/set; bumps refresh generation so stale async refreshes cannot flip state back. */
export function setPersonalAlertNeeded(squadId: string, needed: boolean): void {
  const id = squadId.trim();
  if (!id) return;
  personalAlertsNeededBySquadId.update((m) => ({ ...m, [id]: needed }));
  personalAlertRefreshGenBySquadId.set(id, (personalAlertRefreshGenBySquadId.get(id) ?? 0) + 1);
}

export async function refreshPersonalAlertForSquad(squad: Squad): Promise<void> {
  const id = squad.id.trim();
  if (!id) return;
  const gen = (personalAlertRefreshGenBySquadId.get(id) ?? 0) + 1;
  personalAlertRefreshGenBySquadId.set(id, gen);
  const groupId = announcementsGroupIdForSquad(squad);
  const needed = await needsSquadRosterKeyChoice(id, groupId);
  if (personalAlertRefreshGenBySquadId.get(id) !== gen) return;
  personalAlertsNeededBySquadId.update((m) => ({ ...m, [id]: needed }));

  // Governance needs-action prompts have no backend event to hook (Approach
  // #4 of U9); this reconciliation pass IS the resolution mechanism, run
  // on the same refresh that already re-evaluates the predicate.
  if (groupId) {
    const sourceEventId = `roster-key:${id}`;
    if (needed) {
      void recordActionNeededEntry(groupId, sourceEventId)
        .then(() => hydrateCatchUpCount())
        .catch(() => {});
    } else {
      resolveOneCatchUpEntry(sourceEventId).catch(() => {});
    }
  }
}
