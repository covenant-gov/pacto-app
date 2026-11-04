import { get, writable, type Writable } from 'svelte/store';
import { navigateToTarget } from '../lib/navigation/open-squad-dashboard';
import { getAnnouncementsChannel } from '../lib/parent-navbar';
import { EVENTS_CHANNEL_NAME } from '../lib/squad/hub-channel-names';
import { squads } from './squads';

export type EventsFocus = { parentId: string; eventId: string | null; seriesId: string | null };

/** Deep-link request consumed by the `#events` panel of `parentId`. */
export const eventsFocus: Writable<EventsFocus | null> = writable(null);

function openEventsChannel(parentId: string): void {
  const squad = get(squads).find((s) => s.id === parentId);
  const announcementsGroupId = squad?.channels.length ? getAnnouncementsChannel(squad)?.groupId?.trim() : '';
  if (!announcementsGroupId) return;
  navigateToTarget({
    kind: 'squad-channel',
    squadId: parentId,
    channelId: announcementsGroupId,
    hubChannelName: EVENTS_CHANNEL_NAME,
  });
}

/** Opens `#events` with that event's detail. */
export function focusSquadEvent(parentId: string, eventId: string): void {
  const pid = parentId.trim();
  if (!pid || !eventId) return;
  eventsFocus.set({ parentId: pid, eventId, seriesId: null });
  openEventsChannel(pid);
}

/** Opens `#events` filtered to one weekly series. */
export function focusSquadEventSeries(parentId: string, seriesId: string): void {
  const pid = parentId.trim();
  if (!pid || !seriesId) return;
  eventsFocus.set({ parentId: pid, eventId: null, seriesId });
  openEventsChannel(pid);
}
