import { writable, type Writable } from 'svelte/store';
import { openSquadTools } from '../lib/navigation/open-squad-dashboard';

export type EventsFocus = { parentId: string; eventId: string | null; seriesId: string | null };

/** Deep-link request consumed by the `#tools` events mode of `parentId`. */
export const eventsFocus: Writable<EventsFocus | null> = writable(null);

function openEventsChannel(parentId: string): void {
  openSquadTools(parentId, 'events');
}

/** Opens `#tools` → Events with that event's detail. */
export function focusSquadEvent(parentId: string, eventId: string): void {
  const pid = parentId.trim();
  if (!pid || !eventId) return;
  eventsFocus.set({ parentId: pid, eventId, seriesId: null });
  openEventsChannel(pid);
}

/** Opens `#tools` → Events filtered to one weekly series. */
export function focusSquadEventSeries(parentId: string, seriesId: string): void {
  const pid = parentId.trim();
  if (!pid || !seriesId) return;
  eventsFocus.set({ parentId: pid, eventId: null, seriesId });
  openEventsChannel(pid);
}
