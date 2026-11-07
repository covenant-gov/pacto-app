import { parseDateTime, toZoned } from '@internationalized/date';
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
  occurrenceCount: number;
  excludedWeeks: number[];
}

export type SquadEventFormError =
  | 'titleRequired'
  | 'startInvalid'
  | 'endInvalid'
  | 'endBeforeStart'
  | 'zoneInvalid'
  | 'placeRequired'
  | 'placeBoth'
  | 'linkInvalid'
  | 'startPast'
  | 'countInvalid'
  | 'noOccurrences';

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

/** Resolve overlap times to the earlier instant; reject gaps instead of silently changing the displayed time. */
function civilInstant(value: string, tzid: string): number | null {
  if (!isValidCivilDateTime(value) || !isValidTimeZone(tzid)) return null;
  try {
    const zoned = toZoned(parseDateTime(value), tzid, 'earlier');
    const instant = zoned.toDate().getTime();
    return unixToCivilDateTime(instant / 1000, tzid) === value ? instant : null;
  } catch {
    return null;
  }
}

export function isValidSquadEventStart(values: SquadEventFormValues): boolean {
  return isValidTimeZone(values.startTzid) && (values.allDay
    ? isValidCivilDate(values.start)
    : civilInstant(civilMinutes(values.start), values.startTzid) !== null);
}

export interface SquadEventOccurrence {
  weekOffset: number;
  start: string;
  end: string;
}

function elapsedDuration(values: SquadEventFormValues): number | null {
  const start = civilInstant(civilMinutes(values.start), values.startTzid);
  const end = civilInstant(civilMinutes(values.end), values.startTzid);
  return start !== null && end !== null && end > start ? end - start : null;
}

/** Weekly rows keep their original week offset after a removal; timed ends retain elapsed duration across DST. */
export function squadEventOccurrences(values: SquadEventFormValues): SquadEventOccurrence[] {
  if (!isValidSquadEventStart(values)) return [];
  const count = values.weekly ? values.occurrenceCount : 1;
  if (!Number.isInteger(count) || count < 1 || count > WEEKLY_SERIES_COUNT) return [];
  const duration = values.end && !values.allDay ? elapsedDuration(values) : null;
  return Array.from({ length: count }, (_, weekOffset) => {
    const start = addCivilDays(values.start.slice(0, 10), weekOffset * 7) + (values.allDay ? '' : civilMinutes(values.start).slice(10));
    let end = values.end
      ? addCivilDays(values.end.slice(0, 10), weekOffset * 7) + (values.allDay ? '' : civilMinutes(values.end).slice(10))
      : '';
    const startInstant = !values.allDay ? civilInstant(start, values.startTzid) : null;
    if (duration !== null && startInstant !== null) end = unixToCivilDateTime((startInstant + duration) / 1000, values.startTzid);
    return { weekOffset, start, end };
  }).filter(({ weekOffset }) => !values.weekly || !values.excludedWeeks.includes(weekOffset));
}

export interface SquadEventValidationOptions {
  now?: number;
  original?: SquadEventFormValues;
}

/** Validate the actual retained schedule, including a submission-time clock check. */
export function validateSquadEventSchedule(
  values: SquadEventFormValues,
  { now = Date.now(), original }: SquadEventValidationOptions = {},
): SquadEventFormError | null {
  // Imported overlap intervals may reverse wall-clock order while their stored instants remain valid.
  const unchanged = original && (['allDay', 'start', 'end', 'startTzid'] as const).every((key) => values[key] === original[key]) && !values.weekly;
  if (unchanged) return null;
  if (!isValidTimeZone(values.startTzid.trim())) return 'zoneInvalid';
  const start = values.allDay ? values.start.trim() : civilMinutes(values.start);
  const end = values.allDay ? values.end.trim() : civilMinutes(values.end);
  const validCivil = values.allDay ? isValidCivilDate : isValidCivilDateTime;
  if (!validCivil(start) || (!values.allDay && civilInstant(start, values.startTzid) === null)) return 'startInvalid';
  if (end) {
    if (!validCivil(end) || (!values.allDay && civilInstant(end, values.startTzid) === null)) return 'endInvalid';
    if (values.allDay ? end < start : end <= start) return 'endBeforeStart';
  }
  if (values.weekly && (!Number.isInteger(values.occurrenceCount) || values.occurrenceCount < 1 || values.occurrenceCount > WEEKLY_SERIES_COUNT)) return 'countInvalid';
  const occurrences = squadEventOccurrences(values);
  if (occurrences.length === 0) return 'noOccurrences';
  const today = unixToCivilDateTime(now / 1000, values.startTzid).slice(0, 10);
  const duration = !values.allDay && end ? elapsedDuration(values) : null;
  for (const occurrence of occurrences) {
    const instant = values.allDay ? null : civilInstant(occurrence.start, values.startTzid);
    if (!values.allDay && instant === null) return 'startInvalid';
    if (occurrence.end && !values.allDay) {
      const endInstant = civilInstant(occurrence.end, values.startTzid);
      if (endInstant === null || instant === null || (duration !== null && endInstant - instant !== duration)) return 'endInvalid';
      if (endInstant <= instant) return 'endBeforeStart';
    }
    if (values.allDay ? occurrence.start < today : instant! <= now) return 'startPast';
  }
  return null;
}

/** An unrepresentable preset (for example the second 01:30 during fall-back) leaves the custom end intact. */
export function applySquadEventDuration(values: SquadEventFormValues, minutes: number): SquadEventFormValues {
  if (values.allDay || ![30, 60, 90, 120].includes(minutes)) return values;
  const start = civilInstant(civilMinutes(values.start), values.startTzid);
  if (start === null) return values;
  const expectedEnd = start + minutes * 60_000;
  const end = unixToCivilDateTime(expectedEnd / 1000, values.startTzid);
  if (civilInstant(end, values.startTzid) !== expectedEnd) return values;
  return { ...values, end };
}

export function synchronizeSquadEventStart(values: SquadEventFormValues, nextStart: string, presetMinutes: number | null): SquadEventFormValues {
  const next = { ...values, start: nextStart };
  if (!isValidSquadEventStart(next)) return next;
  if (presetMinutes !== null && !values.allDay) return applySquadEventDuration(next, presetMinutes);
  if (!values.end) return next;
  if (values.allDay) {
    if (isValidCivilDate(values.end) && values.end < nextStart && isValidCivilDate(values.start) && values.end >= values.start) {
      const days = (Date.parse(values.end) - Date.parse(values.start)) / 86400000;
      return { ...next, end: addCivilDays(nextStart, days) };
    }
    return next;
  }
  const nextInstant = civilInstant(civilMinutes(nextStart), values.startTzid)!;
  const endInstant = civilInstant(civilMinutes(values.end), values.startTzid);
  const duration = elapsedDuration(values);
  if (endInstant !== null && endInstant > nextInstant) return next;
  if (duration === null) return next;
  const end = unixToCivilDateTime((nextInstant + duration) / 1000, values.startTzid);
  return civilInstant(end, values.startTzid) === nextInstant + duration ? { ...next, end } : next;
}

export function validateSquadEventForm(values: SquadEventFormValues, options: SquadEventValidationOptions = {}): SquadEventFormError | null {
  if (!values.title.trim()) return 'titleRequired';
  const scheduleError = validateSquadEventSchedule(values, options);
  if (scheduleError) return scheduleError;
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

/** Ids for one account-scoped unsent draft; kept until that kind of send succeeds so a retry cannot create a second event or series. */
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

const draftIdsByKey = new Map<string, SquadEventDraftIds>();

/** Current draft ids for an account/parent/edit `draftKey`, minted on first use and kept across modal close/reopen. */
export function squadEventDraftIds(draftKey: string, newId?: () => string): SquadEventDraftIds {
  let ids = draftIdsByKey.get(draftKey);
  if (!ids) {
    ids = mintSquadEventDraftIds(newId);
    draftIdsByKey.set(draftKey, ids);
  }
  return ids;
}

/** Re-mint consumed ids only when the captured draft generation still owns this key. */
export function settleSquadEventDraftIds(draftKey: string, op: 'create' | 'series', expected: SquadEventDraftIds, newId?: () => string): boolean {
  const current = draftIdsByKey.get(draftKey);
  if (current !== expected) return false;
  const fresh = mintSquadEventDraftIds(newId);
  draftIdsByKey.set(
    draftKey,
    op === 'create'
      ? { ...current, eventId: fresh.eventId }
      : { ...current, seriesId: fresh.seriesId, seriesEventIds: fresh.seriesEventIds },
  );
  return true;
}

export function resetSquadEventDraftIds(): void {
  draftIdsByKey.clear();
}

export type SquadEventSubmission =
  | { op: 'create'; params: { mlsGroupId: string; parentId: string; eventId: string; event: SquadEventInput } }
  | {
      op: 'series';
      params: { mlsGroupId: string; parentId: string; seriesId: string; eventIds: string[]; weekOffsets: number[]; event: SquadEventInput };
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
    const weekOffsets = squadEventOccurrences(values).map(({ weekOffset }) => weekOffset);
    return {
      op: 'series',
      params: { mlsGroupId, parentId, seriesId: ids.seriesId, eventIds: weekOffsets.map((offset) => ids.seriesEventIds[offset]), weekOffsets, event },
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
    occurrenceCount: WEEKLY_SERIES_COUNT,
    excludedWeeks: [],
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
    occurrenceCount: WEEKLY_SERIES_COUNT,
    excludedWeeks: [],
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
