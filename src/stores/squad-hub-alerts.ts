import { get, writable } from 'svelte/store';
import { loadPendingJoinRequestsForSquad } from '../lib/commons/join-requests';
import { needsSquadRosterKeyChoice } from '../lib/squad/squad-roster-key-choice';
import {
  ANNOUNCEMENTS_CHANNEL_NAME,
  JOIN_REQUESTS_CHANNEL_NAME,
  PERSONAL_ALERTS_CHANNEL_NAME,
} from '../lib/squad/hub-channel-names';
import { formatUnreadBadgeCount } from '../lib/dm/dm-unread';
import { persistenceKey } from './persistence-context';
import type { Squad } from './squads';

export const JOIN_REQUEST_ACK_COUNT_PREFIX = 'pacto_join_requests_ack_count';

/** Squad-wide pending Commons join requests (same count for every member). */
export const joinRequestPendingCountBySquadId = writable<Record<string, number>>({});

/** Per-user last acknowledged pending count when opening #join-requests. */
export const joinRequestAckCountBySquadId = writable<Record<string, number>>({});

/** Per-user action needed in #personal-alerts (roster signer prompt). */
export const personalAlertsNeededBySquadId = writable<Record<string, boolean>>({});

const personalAlertRefreshGenBySquadId = new Map<string, number>();

joinRequestAckCountBySquadId.subscribe((value) => {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(JOIN_REQUEST_ACK_COUNT_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota
  }
});

export function loadJoinRequestAckCounts(): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(JOIN_REQUEST_ACK_COUNT_PREFIX);
  if (!key) {
    joinRequestAckCountBySquadId.set({});
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      joinRequestAckCountBySquadId.set({});
      return;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      joinRequestAckCountBySquadId.set({});
      return;
    }
    const out: Record<string, number> = {};
    for (const [sid, count] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof count === 'number' && Number.isFinite(count) && count >= 0) out[sid] = count;
    }
    joinRequestAckCountBySquadId.set(out);
  } catch {
    joinRequestAckCountBySquadId.set({});
  }
}

export function resetSquadHubAlertStores(): void {
  joinRequestPendingCountBySquadId.set({});
  joinRequestAckCountBySquadId.set({});
  personalAlertsNeededBySquadId.set({});
  personalAlertRefreshGenBySquadId.clear();
}

export function joinRequestUnreadCount(
  squadId: string,
  pendingBySquad = get(joinRequestPendingCountBySquadId),
  ackBySquad = get(joinRequestAckCountBySquadId)
): number {
  const id = squadId.trim();
  if (!id) return 0;
  const pending = pendingBySquad[id] ?? 0;
  const ack = ackBySquad[id] ?? 0;
  return Math.max(0, pending - ack);
}

export function hubChannelAlertCount(
  channelName: string,
  squadId: string | null | undefined,
  pendingBySquad = get(joinRequestPendingCountBySquadId),
  ackBySquad = get(joinRequestAckCountBySquadId),
  personalBySquad = get(personalAlertsNeededBySquadId)
): number {
  const sid = squadId?.trim();
  if (!sid) return 0;
  if (channelName === JOIN_REQUESTS_CHANNEL_NAME) {
    return joinRequestUnreadCount(sid, pendingBySquad, ackBySquad);
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

export async function refreshJoinRequestAlertForSquad(squadId: string): Promise<void> {
  const id = squadId.trim();
  if (!id) return;
  const requests = await loadPendingJoinRequestsForSquad(id);
  joinRequestPendingCountBySquadId.update((m) => ({ ...m, [id]: requests.length }));
}

/** Optimistic clear/set; bumps refresh generation so stale async refreshes cannot flip state back. */
export function setPersonalAlertNeeded(squadId: string, needed: boolean): void {
  const id = squadId.trim();
  if (!id) return;
  personalAlertsNeededBySquadId.update((m) => ({ ...m, [id]: needed }));
  if (!needed) {
    personalAlertRefreshGenBySquadId.set(id, (personalAlertRefreshGenBySquadId.get(id) ?? 0) + 1);
  }
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

export async function refreshSquadHubAlerts(squad: Squad): Promise<void> {
  await Promise.all([
    refreshJoinRequestAlertForSquad(squad.id),
    refreshPersonalAlertForSquad(squad),
  ]);
}

export async function refreshAllSquadHubAlerts(squads: Squad[]): Promise<void> {
  await Promise.all(squads.map((s) => refreshSquadHubAlerts(s)));
}

/** Mark current pending join requests as seen for this squad (squad-wide feed, per-user ack). */
export function acknowledgeJoinRequestsForSquad(squadId: string): void {
  const id = squadId.trim();
  if (!id) return;
  const pending = get(joinRequestPendingCountBySquadId)[id] ?? 0;
  joinRequestAckCountBySquadId.update((m) => ({ ...m, [id]: pending }));
}
