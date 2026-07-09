import { get, writable } from 'svelte/store';
import { needsSquadRosterKeyChoice } from '../lib/squad/squad-roster-key-choice';
import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  JOIN_REQUESTS_CHANNEL_NAME,
  PERSONAL_ALERTS_CHANNEL_NAME,
} from '../lib/squad/hub-channel-names';
import { formatUnreadBadgeCount } from '../lib/dm/dm-unread';
import type { CommonsJoinRequestDto } from '../lib/commons/types';
import type { Squad } from './squads';

/** Per-user action needed in #personal-alerts (roster signer prompt). */
export const personalAlertsNeededBySquadId = writable<Record<string, boolean>>({});

const personalAlertRefreshGenBySquadId = new Map<string, number>();

export function resetSquadHubAlertStores(): void {
  personalAlertsNeededBySquadId.set({});
  personalAlertRefreshGenBySquadId.clear();
}

export function hubChannelAlertCount(
  channelName: string,
  squadId: string | null | undefined,
  joinRequestsBySquad: Record<string, CommonsJoinRequestDto[]>,
  personalBySquad = get(personalAlertsNeededBySquadId)
): number {
  const sid = squadId?.trim();
  if (!sid) return 0;
  if (channelName === JOIN_REQUESTS_CHANNEL_NAME) {
    return (joinRequestsBySquad[sid] ?? []).length;
  }
  if (channelName === PERSONAL_ALERTS_CHANNEL_NAME) {
    return personalBySquad[sid] ? 1 : 0;
  }
  return 0;
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
