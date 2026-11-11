import { describe, expect, it } from 'vitest';
import type { SquadEventDto } from '../api/squad-events';
import { orderShelfEvents, shelfCreateControl, shelfOpenEvent } from './squad-events-shelf';

function ev(id: string, fields: Partial<SquadEventDto>): SquadEventDto {
  return {
    id,
    parentId: 'p',
    mlsGroupId: 'g',
    seriesId: null,
    kind: 31923,
    title: id,
    summary: '',
    startUnix: null,
    endUnix: null,
    startDate: null,
    endDate: null,
    startTzid: 'UTC',
    place: 'online',
    location: '',
    channelId: null,
    status: 'active',
    authorNpub: 'a',
    createdAtMs: 0,
    updatedAtMs: 0,
    updatedByNpub: 'a',
    rsvps: [],
    myRsvp: null,
    canEdit: false,
    ...fields,
  };
}

const NOW = Date.UTC(2026, 11, 10, 12, 0);
const unix = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h) / 1000;

describe('orderShelfEvents', () => {
  const events = [
    ev('later', { startUnix: unix(2026, 12, 20, 9) }),
    ev('past-old', { startUnix: unix(2026, 12, 1, 9) }),
    ev('soon', { startUnix: unix(2026, 12, 10, 18) }),
    ev('allday-today', { kind: 31922, startDate: '2026-12-10' }),
    ev('past-recent', { kind: 31922, startDate: '2026-12-08', endDate: '2026-12-09' }),
    ev('ongoing', { startUnix: unix(2026, 12, 10, 11), endUnix: unix(2026, 12, 10, 13) }),
  ];

  it('lists upcoming soonest first (all-day by civil date first), then past most recent first', () => {
    const { upcoming, past } = orderShelfEvents(events, { nowMs: NOW, viewerZone: 'UTC' });
    expect(upcoming.map((e) => e.id)).toEqual(['allday-today', 'ongoing', 'soon', 'later']);
    expect(past.map((e) => e.id)).toEqual(['past-recent', 'past-old']);
  });

  it('filters to one series', () => {
    const series = [ev('a', { seriesId: 's', startUnix: unix(2026, 12, 20) }), ev('b', { startUnix: unix(2026, 12, 20) })];
    const { upcoming } = orderShelfEvents(series, { nowMs: NOW, viewerZone: 'UTC', seriesId: 's' });
    expect(upcoming.map((e) => e.id)).toEqual(['a']);
  });
});

describe('shelfOpenEvent', () => {
  it("opens that event's detail and nothing for a missing id", () => {
    const list = [ev('a', {}), ev('b', {})];
    expect(shelfOpenEvent(list, 'b')).toBe(list[1]);
    expect(shelfOpenEvent(list, 'gone')).toBeNull();
    expect(shelfOpenEvent(list, null)).toBeNull();
  });
});

describe('shelfCreateControl', () => {
  it('hides create when the privilege is denied', () => {
    expect(shelfCreateControl(false)).toBe('denied');
  });

  it('shows create when allowed or when the privilege read failed', () => {
    expect(shelfCreateControl(true)).toBe('create');
    expect(shelfCreateControl(null)).toBe('create');
  });
});
