import {
  WEEKLY_SERIES_COUNT,
  type SquadEventDto,
  type SquadEventInput,
  type SquadEventPlace,
} from '../api/squad-events';
import { isHubChannelRow } from '../parent/channel-access';
import { ANNOUNCEMENTS_CHANNEL_NAME } from './hub-channel-names';

/** Timed `start`/`end` are `YYYY-MM-DDTHH:mm` in `startTzid`; all-day are `YYYY-MM-DD` with an inclusive `end`. Empty `end` = none. */
export interface SquadEventFormValues {
  title: string;
  summary: string;
  allDay: boolean;
  start: string;
  end: string;
  startTzid: string;
  /** Selected kind; only the matching field (`link` or `address`) may be filled. */
  place: SquadEventPlace;
  link: string;
  address: string;
  channelId: string | null;
  weekly: boolean;
}

export type SquadEventFormError =
  | 'titleRequired'
  | 'startInvalid'
  | 'endInvalid'
  | 'endBeforeStart'
  | 'zoneInvalid'
  | 'placeRequired'
  | 'placeBoth'
  | 'linkInvalid';

type ChannelRow = { name: string; groupId: string; order?: number };

export interface EventChannelOption {
  groupId: string;
  name: string;
}

const CIVIL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CIVIL_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** `datetime-local` may carry seconds; the wire format is minutes only. */
function civilMinutes(value: string): string {
  return value.trim().slice(0, 16);
}

function isValidCivilDate(date: string): boolean {
  if (!CIVIL_DATE_RE.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

function isValidCivilDateTime(value: string): boolean {
  if (!CIVIL_DATE_TIME_RE.test(value)) return false;
  const [hh, mm] = value.slice(11).split(':').map(Number);
  return isValidCivilDate(value.slice(0, 10)) && hh < 24 && mm < 60;
}

export function addCivilDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function isValidTimeZone(tzid: string): boolean {
  if (!tzid.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
}

/** IANA zones for the picker; always contains `include` entries that are valid. */
export function timeZoneOptions(include: string[] = []): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];
  const out = new Set(supported);
  for (const z of include) if (z && isValidTimeZone(z)) out.add(z);
  return [...out].sort();
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function validateSquadEventForm(values: SquadEventFormValues): SquadEventFormError | null {
  if (!values.title.trim()) return 'titleRequired';
  const start = values.allDay ? values.start.trim() : civilMinutes(values.start);
  const end = values.allDay ? values.end.trim() : civilMinutes(values.end);
  const validCivil = values.allDay ? isValidCivilDate : isValidCivilDateTime;
  if (!validCivil(start)) return 'startInvalid';
  if (end) {
    if (!validCivil(end)) return 'endInvalid';
    if (values.allDay ? end < start : end <= start) return 'endBeforeStart';
  }
  if (!isValidTimeZone(values.startTzid.trim())) return 'zoneInvalid';
  const link = values.link.trim();
  const address = values.address.trim();
  if (link && address) return 'placeBoth';
  if (!(values.place === 'online' ? link : address)) return 'placeRequired';
  if (values.place === 'online' && !isHttpUrl(link)) return 'linkInvalid';
  return null;
}

/** Wire input from validated form values. All-day `end` turns exclusive; a one-day range sends no end. */
export function buildSquadEventInput(values: SquadEventFormValues): SquadEventInput {
  const location = values.place === 'online' ? values.link.trim() : values.address.trim();
  const start = values.allDay ? values.start.trim() : civilMinutes(values.start);
  const endRaw = values.allDay ? values.end.trim() : civilMinutes(values.end);
  let end: string | null = null;
  if (endRaw) end = values.allDay ? (endRaw === start ? null : addCivilDays(endRaw, 1)) : endRaw;
  return {
    title: values.title.trim(),
    summary: values.summary.trim(),
    allDay: values.allDay,
    start,
    end,
    startTzid: values.startTzid.trim(),
    place: values.place,
    location,
    channelId: values.channelId,
  };
}

/** Ids for one squad's unsent draft; kept until that kind of send succeeds so a retry cannot create a second event or series. */
export interface SquadEventDraftIds {
  eventId: string;
  seriesId: string;
  seriesEventIds: string[];
}

export function mintSquadEventDraftIds(newId: () => string = () => crypto.randomUUID()): SquadEventDraftIds {
  return {
    eventId: newId(),
    seriesId: newId(),
    seriesEventIds: Array.from({ length: WEEKLY_SERIES_COUNT }, () => newId()),
  };
}

const draftIdsByParent = new Map<string, SquadEventDraftIds>();

/** Current draft ids for `parentId`, minted on first use and kept across modal close/reopen. */
export function squadEventDraftIds(parentId: string, newId?: () => string): SquadEventDraftIds {
  let ids = draftIdsByParent.get(parentId);
  if (!ids) {
    ids = mintSquadEventDraftIds(newId);
    draftIdsByParent.set(parentId, ids);
  }
  return ids;
}

/** After a successful send, re-mint only the ids that send consumed. */
export function settleSquadEventDraftIds(parentId: string, op: 'create' | 'series', newId?: () => string): void {
  const current = draftIdsByParent.get(parentId);
  if (!current) return;
  const fresh = mintSquadEventDraftIds(newId);
  draftIdsByParent.set(
    parentId,
    op === 'create'
      ? { ...current, eventId: fresh.eventId }
      : { ...current, seriesId: fresh.seriesId, seriesEventIds: fresh.seriesEventIds },
  );
}

export function resetSquadEventDraftIds(): void {
  draftIdsByParent.clear();
}

export type SquadEventSubmission =
  | { op: 'create'; params: { mlsGroupId: string; parentId: string; eventId: string; event: SquadEventInput } }
  | {
      op: 'series';
      params: { mlsGroupId: string; parentId: string; seriesId: string; eventIds: string[]; event: SquadEventInput };
    }
  | { op: 'update'; params: { mlsGroupId: string; parentId: string; eventId: string; event: SquadEventInput } };

/** Edit → update of `editingId`; weekly → series with the draft ids; otherwise a single create. */
export function buildSquadEventSubmission(args: {
  values: SquadEventFormValues;
  ids: SquadEventDraftIds;
  mlsGroupId: string;
  parentId: string;
  editingId: string | null;
}): SquadEventSubmission {
  const { values, ids, mlsGroupId, parentId, editingId } = args;
  const event = buildSquadEventInput(values);
  if (editingId) return { op: 'update', params: { mlsGroupId, parentId, eventId: editingId, event } };
  if (values.weekly) {
    return {
      op: 'series',
      params: { mlsGroupId, parentId, seriesId: ids.seriesId, eventIds: [...ids.seriesEventIds], event },
    };
  }
  return { op: 'create', params: { mlsGroupId, parentId, eventId: ids.eventId, event } };
}

/** Unix seconds as `YYYY-MM-DDTHH:mm` wall clock in `tzid`. */
export function unixToCivilDateTime(unix: number, tzid: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tzid,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(unix * 1000));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function emptySquadEventFormValues(viewerZone: string, channelId: string | null): SquadEventFormValues {
  return {
    title: '',
    summary: '',
    allDay: false,
    start: '',
    end: '',
    startTzid: viewerZone,
    place: 'online',
    link: '',
    address: '',
    channelId,
    weekly: false,
  };
}

/** Prefill for edit: civil values in the event's own zone; all-day end shown inclusive. */
export function formValuesFromEvent(event: SquadEventDto): SquadEventFormValues {
  const tz = isValidTimeZone(event.startTzid) ? event.startTzid : 'UTC';
  const allDay = event.kind === 31922;
  let start: string;
  let end: string;
  if (allDay) {
    start = event.startDate ?? '';
    end = event.endDate ? addCivilDays(event.endDate, -1) : '';
  } else {
    start = event.startUnix != null ? unixToCivilDateTime(event.startUnix, tz) : '';
    end = event.endUnix != null ? unixToCivilDateTime(event.endUnix, tz) : '';
  }
  return {
    title: event.title,
    summary: event.summary,
    allDay,
    start,
    end,
    startTzid: event.startTzid,
    place: event.place,
    link: event.place === 'online' ? event.location : '',
    address: event.place === 'offline' ? event.location : '',
    channelId: event.channelId,
    weekly: false,
  };
}

/** Announcements (squad-wide) first, then custom channels; one option per MLS group. */
export function eventChannelOptions(channels: ChannelRow[]): EventChannelOption[] {
  const out: EventChannelOption[] = [];
  const seen = new Set<string>();
  const ann = channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME);
  const custom = channels
    .filter((c) => !isHubChannelRow(c) && !c.groupId.startsWith('creating-'))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const c of ann ? [ann, ...custom] : custom) {
    const gid = c.groupId.trim();
    if (!gid || seen.has(gid)) continue;
    seen.add(gid);
    out.push({ groupId: gid, name: c.name });
  }
  return out;
}

/** Display name for an event's `channelId` (a channel `groupId`); shared hub ids resolve to announcements. */
export function eventChannelName(channels: ChannelRow[], channelId: string | null): string | null {
  const id = channelId?.trim();
  if (!id) return null;
  const matches = channels.filter((c) => c.groupId.trim() === id);
  return (matches.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME) ?? matches[0])?.name ?? null;
}
