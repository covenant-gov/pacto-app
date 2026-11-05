import type { SquadEventDto } from '../api/squad-events';
import { canCreateSquadEvent, type SquadContentPolicyView } from '../api/squad-content-policy';

/** `create` shows the button; `adminOnly` / `lockedOut` show why it is absent. */
export type ShelfCreateControl = 'create' | 'adminOnly' | 'lockedOut';

/** Missing policy (load failed) falls back to the default: anyone can create; the backend still enforces. */
export function shelfCreateControl(policy: SquadContentPolicyView | null): ShelfCreateControl {
  if (!policy || canCreateSquadEvent(policy)) return 'create';
  return policy.adminIsMember ? 'adminOnly' : 'lockedOut';
}

function civilDateInZone(unix: number, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(unix * 1000),
  );
}

/** Sort key: civil date (all-day as stored, timed in the viewer zone), then all-day first, then instant. */
function startKey(e: SquadEventDto, viewerZone: string): [string, number] {
  if (e.startUnix != null) return [civilDateInZone(e.startUnix, viewerZone), e.startUnix];
  return [e.startDate ?? '', Number.NEGATIVE_INFINITY];
}

function compareStart(a: SquadEventDto, b: SquadEventDto, viewerZone: string): number {
  const [ad, at] = startKey(a, viewerZone);
  const [bd, bt] = startKey(b, viewerZone);
  if (ad !== bd) return ad < bd ? -1 : 1;
  if (at !== bt) return at < bt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Still upcoming until its end (or start when no end); all-day until its last civil day ends in the viewer zone. */
function isUpcoming(e: SquadEventDto, nowMs: number, viewerZone: string): boolean {
  if (e.startUnix != null) return (e.endUnix ?? e.startUnix) * 1000 >= nowMs;
  const today = civilDateInZone(Math.floor(nowMs / 1000), viewerZone);
  const lastDayExclusive = e.endDate ?? '';
  if (lastDayExclusive) return lastDayExclusive > today;
  return (e.startDate ?? '') >= today;
}

/** Upcoming soonest first, then past most recent first. Optional series filter. */
export function orderShelfEvents(
  events: SquadEventDto[],
  opts: { nowMs: number; viewerZone: string; seriesId?: string | null },
): { upcoming: SquadEventDto[]; past: SquadEventDto[] } {
  const filtered = opts.seriesId ? events.filter((e) => e.seriesId === opts.seriesId) : events;
  const upcoming: SquadEventDto[] = [];
  const past: SquadEventDto[] = [];
  for (const e of filtered) (isUpcoming(e, opts.nowMs, opts.viewerZone) ? upcoming : past).push(e);
  upcoming.sort((a, b) => compareStart(a, b, opts.viewerZone));
  past.sort((a, b) => compareStart(b, a, opts.viewerZone));
  return { upcoming, past };
}

/** Event whose detail is open, or null when it is gone from the replica. */
export function shelfOpenEvent(events: SquadEventDto[], openEventId: string | null): SquadEventDto | null {
  if (!openEventId) return null;
  return events.find((e) => e.id === openEventId) ?? null;
}
