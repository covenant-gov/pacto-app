import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

export const COMMONS_BROADCAST_DURATION_HOURS = [24, 48, 72, 168, 336, 720] as const;

export type CommonsBroadcastDurationHours = (typeof COMMONS_BROADCAST_DURATION_HOURS)[number];

export const COMMONS_BROADCAST_DURATION_ROWS: ReadonlyArray<
  ReadonlyArray<{ hours: CommonsBroadcastDurationHours; label: string }>
> = [
  [
    { hours: 24, label: 'commons.duration.hours' },
    { hours: 48, label: 'commons.duration.hours' },
    { hours: 72, label: 'commons.duration.hours' },
  ],
  [
    { hours: 168, label: 'commons.duration.week' },
    { hours: 336, label: 'commons.duration.fortnight' },
    { hours: 720, label: 'commons.duration.month' },
  ],
];

export function formatCommonsBroadcastDuration(hours: number): string {
  for (const row of COMMONS_BROADCAST_DURATION_ROWS) {
    for (const opt of row) {
      if (opt.hours === hours) return get(t)(opt.label, { values: { hours: opt.hours } });
    }
  }
  return get(t)('commons.duration.hours', { values: { hours } });
}

export function isCommonsBroadcastDurationHours(h: number): h is CommonsBroadcastDurationHours {
  return (COMMONS_BROADCAST_DURATION_HOURS as readonly number[]).includes(h);
}
