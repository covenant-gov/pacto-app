import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import type { EventClockFormat } from '../../stores/event-time-format';
import type { NostrProfile } from '../api/nostr';
import type { SquadEventRsvpDto, SquadEventRsvpStatus } from '../api/squad-events';
import { getProfileDisplayName } from '../utils/profile';

export type SquadEventStartFields = { startUnix: number | null; startDate: string | null; startTzid: string };
export type SquadEventRangeFields = SquadEventStartFields & { endUnix: number | null; endDate: string | null };
export type EventTimeOptions = { locale?: string; viewerZone?: string; clockFormat?: EventClockFormat };
export type RsvpCounts = Record<SquadEventRsvpStatus, number>;

export const RSVP_STATUSES: readonly SquadEventRsvpStatus[] = ['accepted', 'tentative', 'declined'];

/** Latest answer per member; equal timestamps keep the first seen. */
export function latestRsvps(rsvps: readonly SquadEventRsvpDto[]): SquadEventRsvpDto[] {
  const byMember = new Map<string, SquadEventRsvpDto>();
  for (const r of rsvps) {
    const prev = byMember.get(r.memberNpub);
    if (!prev || r.updatedAtMs > prev.updatedAtMs) byMember.set(r.memberNpub, r);
  }
  return [...byMember.values()];
}

export function rsvpCounts(rsvps: readonly SquadEventRsvpDto[]): RsvpCounts {
  const counts: RsvpCounts = { accepted: 0, tentative: 0, declined: 0 };
  for (const r of latestRsvps(rsvps)) counts[r.status] += 1;
  return counts;
}

export function rsvpMembersByStatus(rsvps: readonly SquadEventRsvpDto[]): Record<SquadEventRsvpStatus, string[]> {
  const out: Record<SquadEventRsvpStatus, string[]> = { accepted: [], tentative: [], declined: [] };
  for (const r of latestRsvps(rsvps)) out[r.status].push(r.memberNpub);
  return out;
}

/** "You" for the viewer; otherwise the app-wide profile display (nickname, name, then short npub). */
export function memberDisplayLabel(
  npub: string,
  profile: NostrProfile | null | undefined,
  selfNpub: string | null | undefined,
  youLabel: string,
): string {
  if (selfNpub && npub === selfNpub) return youLabel;
  return profile ? getProfileDisplayName(profile) : npub.slice(0, 16);
}

export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function isValidZone(tzid: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
}

const TIMED_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

const CIVIL_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
};

const TIME_ONLY_FORMAT: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

/** `YYYY-MM-DD` as a UTC midnight so formatting in UTC keeps the civil date. */
function civilDateToUtc(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const parsed = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  parsed.setUTCFullYear(Number(m[1]));
  return parsed.toISOString().slice(0, 10) === date ? parsed : null;
}

function formatCivilDate(date: string, locale?: string): string {
  const d = civilDateToUtc(date);
  return d ? new Intl.DateTimeFormat(locale, CIVIL_DATE_FORMAT).format(d) : date;
}

function clockOptions(format: EventClockFormat = 'system'): Intl.DateTimeFormatOptions {
  return format === 'system' ? {} : { hourCycle: format === '12h' ? 'h12' : 'h23', hour: format === '24h' ? '2-digit' : 'numeric' };
}

function formatUnix(unix: number, zone: string, locale: string | undefined, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).format(new Date(unix * 1000));
}

function zoneDayKey(unix: number, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(unix * 1000),
  );
}

function resolveViewerZone(opts?: EventTimeOptions): string {
  const zone = opts?.viewerZone ?? viewerTimeZone();
  return isValidZone(zone) ? zone : 'UTC';
}

/** Timed: viewer zone. All-day: the stored civil date, never shifted. */
export function formatEventStart(start: SquadEventStartFields, opts?: EventTimeOptions): string {
  if (start.startUnix != null) return formatUnix(start.startUnix, resolveViewerZone(opts), opts?.locale, { ...TIMED_FORMAT, ...clockOptions(opts?.clockFormat) });
  return start.startDate ? formatCivilDate(start.startDate, opts?.locale) : '';
}

/** End label, or null when absent. Timed same-day ends show the time only; all-day ends are exclusive, so the last day is shown. */
export function formatEventEnd(range: SquadEventRangeFields, opts?: EventTimeOptions): string | null {
  if (range.startUnix != null) {
    if (range.endUnix == null) return null;
    const zone = resolveViewerZone(opts);
    const sameDay = zoneDayKey(range.startUnix, zone) === zoneDayKey(range.endUnix, zone);
    return formatUnix(range.endUnix, zone, opts?.locale, { ...(sameDay ? TIME_ONLY_FORMAT : TIMED_FORMAT), ...clockOptions(opts?.clockFormat) });
  }
  if (!range.startDate || !range.endDate) return null;
  const start = civilDateToUtc(range.startDate);
  const end = civilDateToUtc(range.endDate);
  if (!start || !end) return null;
  const lastDay = new Date(end.getTime() - 86_400_000);
  if (lastDay.getTime() <= start.getTime()) return null;
  return new Intl.DateTimeFormat(opts?.locale, CIVIL_DATE_FORMAT).format(lastDay);
}

export function eventZoneDiffers(startTzid: string, viewerZone?: string): boolean {
  const tz = startTzid.trim();
  return tz !== '' && tz !== (viewerZone ?? viewerTimeZone());
}

/** Timed start rendered in `startTzid`; null for all-day, same zone, or an unknown zone. */
export function formatEventZoneStart(start: SquadEventStartFields, opts?: EventTimeOptions): string | null {
  if (start.startUnix == null) return null;
  const tz = start.startTzid.trim();
  if (!eventZoneDiffers(tz, opts?.viewerZone) || !isValidZone(tz)) return null;
  return formatUnix(start.startUnix, tz, opts?.locale, { ...TIMED_FORMAT, ...clockOptions(opts?.clockFormat), weekday: undefined, timeZoneName: 'short' });
}

/** Millisecond timestamp in the viewer zone. */
export function formatEventTimestampMs(ms: number, opts?: EventTimeOptions): string {
  return new Intl.DateTimeFormat(opts?.locale, {
    hourCycle: clockOptions(opts?.clockFormat).hourCycle,
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: resolveViewerZone(opts),
  }).format(new Date(ms));
}


/** Preview a civil input in its event zone without interpreting it in the machine zone. */
export function formatEventCivil(civil: string, opts?: EventTimeOptions): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(civil)) return formatCivilDate(civil, opts?.locale);
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(civil);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59) return civil;
  const date = civilDateToUtc(match[1]);
  if (!date) return civil;
  date.setUTCHours(Number(match[2]), Number(match[3]));
  return new Intl.DateTimeFormat(opts?.locale, { ...TIMED_FORMAT, ...clockOptions(opts?.clockFormat), timeZone: 'UTC' }).format(date);
}

/** Timed duration is elapsed time; all-day duration is the exclusive calendar span. */
export function formatEventDuration(range: SquadEventRangeFields, opts?: EventTimeOptions): string {
  const unspecified = () => get(t)('events.duration.unspecified', { locale: opts?.locale });
  const unit = (value: number, name: 'hour' | 'minute' | 'second' | 'day') =>
    new Intl.NumberFormat(opts?.locale, { style: 'unit', unit: name, unitDisplay: name === 'day' ? 'long' : 'short', maximumFractionDigits: 9 }).format(value);
  if (range.startUnix != null) {
    if (range.endUnix == null || !Number.isFinite(range.endUnix) || !Number.isFinite(range.startUnix) || range.endUnix <= range.startUnix) return unspecified();
    const seconds = range.endUnix - range.startUnix;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return [hours ? unit(hours, 'hour') : '', minutes ? unit(minutes, 'minute') : '', remainder ? unit(remainder, 'second') : ''].filter(Boolean).join(' ');
  }
  const start = range.startDate ? civilDateToUtc(range.startDate) : null;
  const end = range.endDate ? civilDateToUtc(range.endDate) : null;
  if (!start || !end || end <= start) return unspecified();
  return unit((end.getTime() - start.getTime()) / 86400000, 'day');
}
