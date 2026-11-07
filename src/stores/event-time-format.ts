import { writable } from 'svelte/store';
import { currentNpubForPersistence, persistenceKey } from './persistence-context';

export type EventClockFormat = 'system' | '12h' | '24h';
const PREFIX = 'pacto_event_time_format_v1';

export const eventTimeFormat = writable<EventClockFormat>('system');

function parseFormat(value: unknown): EventClockFormat {
  return value === '12h' || value === '24h' ? value : 'system';
}

currentNpubForPersistence.subscribe(() => {
  const key = persistenceKey(PREFIX);
  let value: EventClockFormat = 'system';
  try {
    if (key && typeof localStorage !== 'undefined') value = parseFormat(localStorage.getItem(key));
  } catch {
    // Storage can be unavailable; keep the system preference for this account.
  }
  eventTimeFormat.set(value);
});

eventTimeFormat.subscribe((value) => {
  const key = persistenceKey(PREFIX);
  try {
    if (key && typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // The current session still honors the selected format.
  }
});

export function eventClockHour12(format: EventClockFormat = 'system', locale?: string): boolean {
  if (format !== 'system') return format === '12h';
  return new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12 ?? false;
}
