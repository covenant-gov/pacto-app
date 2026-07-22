import { get, writable } from 'svelte/store';
import { needsSquadRosterKeyChoice } from '../lib/squad/squad-roster-key-choice';
import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  MY_DASHBOARD_CHANNEL_NAME,
  SQUAD_DASHBOARD_CHANNEL_NAME,
} from '../lib/squad/hub-channel-names';
import { formatUnreadBadgeCount } from '../lib/dm/dm-unread';
import type { CommonsJoinRequestDto } from '../lib/commons/types';
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

export function hubChannelAlertCount(
  channelName: string,
  squadId: string | null | undefined,
  joinRequestsBySquad: Record<string, CommonsJoinRequestDto[]>,
  personalBySquad: Record<string, boolean> = get(personalAlertsNeededBySquadId),
  mentionsBySquad: Record<string, number> = {}
): number {
  const sid = squadId?.trim();
  if (!sid) return 0;
  let count = 0;
  if (channelName === SQUAD_DASHBOARD_CHANNEL_NAME) {
    count += (joinRequestsBySquad[sid] ?? []).length;
  }
  if (channelName === MY_DASHBOARD_CHANNEL_NAME) {
    count += personalBySquad[sid] ? 1 : 0;
  }
  count += mentionsBySquad[`${sid}:${channelName}`] ?? 0;
  return count;
}

export function formatHubChannelAlertCount(count: number): string {
  return formatUnreadBadgeCount(count);
}

function announcementsGroupIdForSquad(squad: Squad): string | null {
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
  const needed = await needsSquadRosterKeyChoice(id, announcementsGroupIdForSquad(squad));
  if (personalAlertRefreshGenBySquadId.get(id) !== gen) return;
  personalAlertsNeededBySquadId.update((m) => ({ ...m, [id]: needed }));
}
