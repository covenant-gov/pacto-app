import { invoke } from './index';

export type SquadEventRsvpStatus = 'accepted' | 'tentative' | 'declined';
export type SquadEventPlace = 'online' | 'offline';
export type SquadEventStatus = 'active' | 'cancelled';

/** Form input. Timed `start`/`end` are civil `YYYY-MM-DDTHH:mm` in `startTzid`; all-day are `YYYY-MM-DD` (end exclusive). */
export interface SquadEventInput {
  title: string;
  summary: string;
  allDay: boolean;
  start: string;
  end: string | null;
  startTzid: string;
  place: SquadEventPlace;
  /** Link when online, address when offline. Member-only; never shown on cards, banners, or Catch up. */
  location: string;
  channelId: string | null;
}

export interface SquadEventRsvpDto {
  memberNpub: string;
  status: SquadEventRsvpStatus;
  updatedAtMs: number;
}

/** Replica row (`list_squad_events`). Exactly one of `startUnix` (timed, 31923) or `startDate` (all-day, 31922) is set. */
export interface SquadEventDto {
  id: string;
  parentId: string;
  mlsGroupId: string;
  seriesId: string | null;
  kind: 31922 | 31923;
  title: string;
  summary: string;
  startUnix: number | null;
  endUnix: number | null;
  startDate: string | null;
  endDate: string | null;
  startTzid: string;
  place: SquadEventPlace;
  location: string;
  channelId: string | null;
  status: SquadEventStatus;
  authorNpub: string;
  createdAtMs: number;
  updatedAtMs: number;
  updatedByNpub: string;
  rsvps: SquadEventRsvpDto[];
  myRsvp: SquadEventRsvpStatus | null;
  /** Caller is the author or a squad admin. */
  canEdit: boolean;
}

/** Local-only reminder settings for one event on this device. */
export interface SquadEventReminderPrefs {
  leadMinutes: number;
  muted: boolean;
}

/** Payload of the `squad_event_reminder_due` event (on-time reminder while the window is focused). */
export interface SquadEventReminderDue {
  eventId: string;
  parentId: string;
  mlsGroupId: string;
  title: string;
  startUnix: number | null;
  startDate: string | null;
  startTzid: string;
}

/** Payload of the `squad_event_replica_updated` event. */
export interface SquadEventReplicaUpdated {
  parentId: string;
  eventId: string | null;
}

export const SQUAD_EVENT_REPLICA_UPDATED = 'squad_event_replica_updated';
export const SQUAD_EVENT_REMINDER_DUE = 'squad_event_reminder_due';
export const DEFAULT_REMINDER_LEAD_MINUTES = 15;
export const WEEKLY_SERIES_COUNT = 8;

export async function listSquadEvents(parentId: string): Promise<SquadEventDto[]> {
  return await invoke<SquadEventDto[]>('list_squad_events', { parentId });
}

/** One meeting: a single announcements card. `eventId` is minted by the caller so a retry reuses it. */
export async function sendSquadEventCreate(params: {
  mlsGroupId: string;
  parentId: string;
  eventId: string;
  event: SquadEventInput;
}): Promise<void> {
  await invoke('send_squad_event_create', params);
}

/** Selected weekly occurrences: stable ids paired with original week offsets plus one series card. */
export async function sendSquadEventSeries(params: {
  mlsGroupId: string;
  parentId: string;
  seriesId: string;
  eventIds: string[];
  weekOffsets: number[];
  event: SquadEventInput;
}): Promise<void> {
  await invoke('send_squad_event_series', params);
}

export async function sendSquadEventUpdate(params: {
  mlsGroupId: string;
  parentId: string;
  eventId: string;
  event: SquadEventInput;
}): Promise<void> {
  await invoke('send_squad_event_update', params);
}

export async function sendSquadEventCancel(params: {
  mlsGroupId: string;
  parentId: string;
  eventId: string;
}): Promise<void> {
  await invoke('send_squad_event_cancel', params);
}

export async function sendSquadEventRsvp(params: {
  mlsGroupId: string;
  parentId: string;
  eventId: string;
  status: SquadEventRsvpStatus;
}): Promise<void> {
  await invoke('send_squad_event_rsvp', params);
}

export async function getSquadEventReminderPrefs(eventId: string): Promise<SquadEventReminderPrefs> {
  return await invoke<SquadEventReminderPrefs>('get_squad_event_reminder_prefs', { eventId });
}

export async function setSquadEventReminderPrefs(params: {
  eventId: string;
  leadMinutes: number;
  muted: boolean;
}): Promise<void> {
  await invoke('set_squad_event_reminder_prefs', params);
}

/** Opening the detail resolves any missed-reminder Catch up entries for this event. */
export async function resolveSquadEventReminderCatchUp(eventId: string): Promise<void> {
  await invoke('resolve_squad_event_reminder_catch_up', { eventId });
}
