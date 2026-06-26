export const COMMONS_BROADCAST_DURATION_HOURS = [24, 48, 72, 168, 336, 720] as const;

export type CommonsBroadcastDurationHours = (typeof COMMONS_BROADCAST_DURATION_HOURS)[number];

export const COMMONS_BROADCAST_DURATION_ROWS: ReadonlyArray<
  ReadonlyArray<{ hours: CommonsBroadcastDurationHours; label: string }>
> = [
  [
    { hours: 24, label: '24 h' },
    { hours: 48, label: '48 h' },
    { hours: 72, label: '72 h' },
  ],
  [
    { hours: 168, label: 'Week' },
    { hours: 336, label: 'Fortnight' },
    { hours: 720, label: 'Month' },
  ],
];

export function formatCommonsBroadcastDuration(hours: number): string {
  for (const row of COMMONS_BROADCAST_DURATION_ROWS) {
    for (const opt of row) {
      if (opt.hours === hours) return opt.label;
    }
  }
  return `${hours} h`;
}

export function isCommonsBroadcastDurationHours(h: number): h is CommonsBroadcastDurationHours {
  return (COMMONS_BROADCAST_DURATION_HOURS as readonly number[]).includes(h);
}
