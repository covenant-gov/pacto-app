import { afterEach, describe, expect, it } from 'vitest';
import type { SquadEventDto } from '../api/squad-events';
import {
  applySquadEventDuration,
  synchronizeSquadEventStart,
  squadEventOccurrences,
  validateSquadEventSchedule,
  buildSquadEventInput,
  buildSquadEventSubmission,
  emptySquadEventFormValues,
  eventChannelName,
  eventChannelOptions,
  formValuesFromEvent,
  mintSquadEventDraftIds,
  resetSquadEventDraftIds,
  settleSquadEventDraftIds,
  squadEventDraftIds,
  validateSquadEventForm,
  type SquadEventFormValues,
} from './squad-event-form';

function form(overrides: Partial<SquadEventFormValues> = {}): SquadEventFormValues {
  return {
    ...emptySquadEventFormValues('America/New_York', 'g-ann'),
    title: 'Standup',
    start: '2026-12-01T10:00',
    link: 'https://meet.example/abc',
    ...overrides,
  };
}

let counter = 0;
const seqId = () => `id-${++counter}`;

describe('validateSquadEventForm', () => {
  it('accepts a complete timed online event', () => {
    expect(validateSquadEventForm(form())).toBeNull();
  });

  it('rejects an empty title', () => {
    expect(validateSquadEventForm(form({ title: '   ' }))).toBe('titleRequired');
  });

  it('rejects a link and an address together', () => {
    expect(validateSquadEventForm(form({ address: '1 Main St' }))).toBe('placeBoth');
    expect(validateSquadEventForm(form({ place: 'offline', address: '1 Main St' }))).toBe('placeBoth');
  });

  it('requires the field that matches the place kind', () => {
    expect(validateSquadEventForm(form({ link: '' }))).toBe('placeRequired');
    expect(validateSquadEventForm(form({ place: 'offline', link: '' }))).toBe('placeRequired');
    expect(validateSquadEventForm(form({ link: 'meet.example' }))).toBe('linkInvalid');
    expect(validateSquadEventForm(form({ place: 'offline', link: '', address: '1 Main St' }))).toBeNull();
  });

  it('checks start, end order, and zone', () => {
    expect(validateSquadEventForm(form({ start: '' }))).toBe('startInvalid');
    expect(validateSquadEventForm(form({ end: '2026-12-01T09:00' }))).toBe('endBeforeStart');
    expect(validateSquadEventForm(form({ startTzid: 'Mars/Base' }))).toBe('zoneInvalid');
    expect(validateSquadEventForm(form({ allDay: true, start: '2026-02-30' }))).toBe('startInvalid');
    expect(validateSquadEventForm(form({ allDay: true, start: '2026-12-01', end: '2026-12-01' }))).toBeNull();
  });
});

describe('buildSquadEventInput', () => {
  it('turns an inclusive all-day end into the exclusive wire end', () => {
    const input = buildSquadEventInput(form({ allDay: true, start: '2026-12-01', end: '2026-12-03' }));
    expect(input).toMatchObject({ allDay: true, start: '2026-12-01', end: '2026-12-04' });
    expect(buildSquadEventInput(form({ allDay: true, start: '2026-12-01', end: '2026-12-01' })).end).toBeNull();
  });

  it('sends only the location for the chosen kind', () => {
    expect(buildSquadEventInput(form())).toMatchObject({ place: 'online', location: 'https://meet.example/abc' });
    expect(buildSquadEventInput(form({ place: 'offline', link: '', address: ' 1 Main St ' }))).toMatchObject({
      place: 'offline',
      location: '1 Main St',
    });
  });
});

describe('weekly submission ids', () => {
  it('mints eight unique event ids and one series id', () => {
    const ids = mintSquadEventDraftIds(seqId);
    expect(ids.seriesEventIds).toHaveLength(8);
    expect(new Set([...ids.seriesEventIds, ids.seriesId, ids.eventId]).size).toBe(10);
  });

  it('reuses the same ids across retries', () => {
    const ids = mintSquadEventDraftIds(seqId);
    const args = { values: form({ weekly: true }), ids, mlsGroupId: 'g', parentId: 'p', editingId: null };
    const first = buildSquadEventSubmission(args);
    const retry = buildSquadEventSubmission(args);
    expect(first.op).toBe('series');
    if (first.op !== 'series' || retry.op !== 'series') throw new Error('expected series');
    expect(first.params.seriesId).toBe(ids.seriesId);
    expect(first.params.eventIds).toEqual(ids.seriesEventIds);
    expect(retry.params).toEqual(first.params);
  });

  it('creates one event with the minted id, and edits update the existing id', () => {
    const ids = mintSquadEventDraftIds(seqId);
    const single = buildSquadEventSubmission({ values: form(), ids, mlsGroupId: 'g', parentId: 'p', editingId: null });
    expect(single).toMatchObject({ op: 'create', params: { eventId: ids.eventId } });
    const edit = buildSquadEventSubmission({
      values: form({ weekly: true }),
      ids,
      mlsGroupId: 'g',
      parentId: 'p',
      editingId: 'existing',
    });
    expect(edit).toMatchObject({ op: 'update', params: { eventId: 'existing' } });
  });
});

describe('scoped draft ids', () => {
  afterEach(() => resetSquadEventDraftIds());

  it('survive reopening until the matching send succeeds', () => {
    const first = squadEventDraftIds('p1', seqId);
    // Close + reopen after a failed or unclear send: same ids.
    expect(squadEventDraftIds('p1', seqId)).toEqual(first);
    expect(squadEventDraftIds('p2', seqId).eventId).not.toBe(first.eventId);

    settleSquadEventDraftIds('p1', 'create', first, seqId);
    const afterCreate = squadEventDraftIds('p1', seqId);
    expect(afterCreate.eventId).not.toBe(first.eventId);
    expect(afterCreate.seriesId).toBe(first.seriesId);
    expect(afterCreate.seriesEventIds).toEqual(first.seriesEventIds);

    settleSquadEventDraftIds('p1', 'series', afterCreate, seqId);
    const afterSeries = squadEventDraftIds('p1', seqId);
    expect(afterSeries.eventId).toBe(afterCreate.eventId);
    expect(afterSeries.seriesId).not.toBe(first.seriesId);
    expect(afterSeries.seriesEventIds).toHaveLength(8);
    expect(afterSeries.seriesEventIds.some((id) => first.seriesEventIds.includes(id))).toBe(false);
  });
});

describe('formValuesFromEvent', () => {
  it('prefills timed values in the event zone and all-day end inclusive', () => {
    const base: Omit<SquadEventDto, 'kind' | 'startUnix' | 'startDate'> = {
      id: 'e',
      parentId: 'p',
      mlsGroupId: 'g',
      seriesId: null,
      title: 'T',
      summary: '',
      endUnix: null,
      endDate: null,
      startTzid: 'America/New_York',
      place: 'offline',
      location: '1 Main St',
      channelId: 'g',
      status: 'active',
      authorNpub: 'a',
      createdAtMs: 0,
      updatedAtMs: 0,
      updatedByNpub: 'a',
      rsvps: [],
      myRsvp: null,
      canEdit: true,
    };
    const timed: SquadEventDto = { ...base, kind: 31923, startUnix: 1_796_137_200, startDate: null };
    expect(formValuesFromEvent(timed)).toMatchObject({ allDay: false, start: '2026-12-01T10:00', address: '1 Main St', link: '' });
    const allDay: SquadEventDto = { ...base, kind: 31922, startUnix: null, startDate: '2026-12-01', endDate: '2026-12-04' };
    expect(formValuesFromEvent(allDay)).toMatchObject({ allDay: true, start: '2026-12-01', end: '2026-12-03' });
  });
});

describe('event channels', () => {
  const channels = [
    { name: 'announcements', groupId: 'g', order: 0 },
    { name: 'polls', groupId: 'g', order: 1 },
    { name: 'events', groupId: 'g', order: 2 },
    { name: 'ops', groupId: 'g-ops', order: 3 },
    { name: 'settings', groupId: '__squad_settings__', order: 4 },
  ];

  it('offers announcements then custom channels', () => {
    expect(eventChannelOptions(channels)).toEqual([
      { groupId: 'g', name: 'announcements' },
      { groupId: 'g-ops', name: 'ops' },
    ]);
  });

  it('resolves shared hub ids to announcements', () => {
    expect(eventChannelName(channels, 'g')).toBe('announcements');
    expect(eventChannelName(channels, 'g-ops')).toBe('ops');
    expect(eventChannelName(channels, 'gone')).toBeNull();
    expect(eventChannelName(channels, null)).toBeNull();
  });
});


describe('scheduling dates and retained occurrences', () => {
  const now = Date.parse('2026-03-01T12:00:00Z');
  it('validates instants in the chosen zone again for stale drafts', () => {
    const values = form({ start: '2026-03-01T08:00' });
    expect(validateSquadEventSchedule(values, { now })).toBeNull();
    expect(validateSquadEventSchedule(values, { now: now + 3600000 })).toBe('startPast');
    expect(validateSquadEventSchedule(form({ start: '2026-03-01T06:00' }), { now })).toBe('startPast');
  });
  it('permits metadata edits of historical events but validates a reschedule', () => {
    const original = form({ start: '2025-01-01T10:00' });
    expect(validateSquadEventSchedule({ ...original, title: 'Renamed' }, { now, original })).toBeNull();
    expect(validateSquadEventSchedule({ ...original, end: '2025-01-01T11:00' }, { now, original })).toBe('startPast');
  });
  it('preserves metadata-only edits of imported overlap intervals with reversed civil clocks', () => {
    const original = form({ start: '2026-11-01T01:45', end: '2026-11-01T01:30' });
    expect(validateSquadEventSchedule({ ...original, summary: 'Updated notes' }, { now, original })).toBeNull();
    expect(validateSquadEventSchedule({ ...original, end: '2026-11-01T01:20' }, { now, original })).toBe('endBeforeStart');
  });
  it('rejects DST gaps, resolves overlaps earlier and accepts all-day today in zone', () => {
    expect(validateSquadEventSchedule(form({ start: '2026-03-08T02:30' }), { now })).toBe('startInvalid');
    expect(validateSquadEventSchedule(form({ start: '2026-11-01T01:30' }), { now: Date.parse('2026-11-01T06:00Z') })).toBe('startPast');
    expect(validateSquadEventSchedule(form({ allDay: true, start: '2026-03-01', end: '2026-03-01' }), { now })).toBeNull();
  });
  it.each([30, 60, 90, 120])('applies %i elapsed minutes across midnight', (minutes) => {
    const values = applySquadEventDuration(form({ start: '2026-12-01T23:45' }), minutes);
    expect(values.end).toBe(`2026-12-02T${String(Math.floor((minutes - 15) / 60)).padStart(2, '0')}:${String((minutes - 15) % 60).padStart(2, '0')}`);
    expect(synchronizeSquadEventStart(values, '2026-12-01T23:00', minutes).end).not.toBe(values.end);
  });
  it('uses elapsed duration through spring-forward and never applies an invalid start', () => {
    expect(applySquadEventDuration(form({ start: '2026-03-08T01:30' }), 60).end).toBe('2026-03-08T03:30');
    expect(applySquadEventDuration(form({ start: '' }), 60).end).toBe('');
    expect(applySquadEventDuration(form({ start: '2026-03-08T02:30' }), 60).end).toBe('');
    const ambiguousEnd = applySquadEventDuration(form({ start: '2026-11-01T00:30' }), 120);
    expect(ambiguousEnd.end).toBe(''); // 01:30 later offset cannot be represented unambiguously by this wire format.
  });
  it('shifts invalid custom ends by prior duration, preserves valid ends and omitted ends', () => {
    const values = form({ end: '2026-12-01T11:30' });
    expect(synchronizeSquadEventStart(values, '2026-12-02T23:00', null).end).toBe('2026-12-03T00:30');
    expect(synchronizeSquadEventStart(values, '2026-12-01T09:00', null).end).toBe(values.end);
    expect(synchronizeSquadEventStart(form(), '2026-12-02T10:00', null).end).toBe('');
    expect(synchronizeSquadEventStart(form({ allDay: true, start: '2026-12-01', end: '2026-12-03' }), '2026-12-08', null).end).toBe('2026-12-10');
  });
  it('keeps removed middle weeks absent without moving later dates or retry ids', () => {
    const values = form({ weekly: true, occurrenceCount: 4, excludedWeeks: [0, 2] });
    expect(squadEventOccurrences(values)).toEqual([
      { weekOffset: 1, start: '2026-12-08T10:00', end: '' },
      { weekOffset: 3, start: '2026-12-22T10:00', end: '' },
    ]);
    const ids = mintSquadEventDraftIds(seqId);
    const args = { values, ids, mlsGroupId: 'g', parentId: 'p', editingId: null };
    expect(buildSquadEventSubmission(args)).toMatchObject({ params: { weekOffsets: [1, 3], eventIds: [ids.seriesEventIds[1], ids.seriesEventIds[3]] } });
    expect(buildSquadEventSubmission(args)).toEqual(buildSquadEventSubmission(args));
    expect(validateSquadEventSchedule({ ...values, excludedWeeks: [0, 1, 2, 3] }, { now })).toBe('noOccurrences');
  });
  it.each([0, 9, 1.5, NaN])('rejects invalid count %s', (occurrenceCount) => {
    expect(validateSquadEventSchedule(form({ weekly: true, occurrenceCount }), { now })).toBe('countInvalid');
  });
  it('accepts bounds and removes first, last or middle without replacement', () => {
    expect(squadEventOccurrences(form({ weekly: true, occurrenceCount: 1 }))).toHaveLength(1);
    expect(squadEventOccurrences(form({ weekly: true, occurrenceCount: 8 }))).toHaveLength(8);
    expect(squadEventOccurrences(form({ weekly: true, occurrenceCount: 3, excludedWeeks: [2] })).map((row) => row.start)).toEqual(['2026-12-01T10:00', '2026-12-08T10:00']);
  });
  it('previews elapsed meeting ends across a weekly DST transition', () => {
    expect(squadEventOccurrences(form({ weekly: true, occurrenceCount: 2, start: '2026-03-01T01:30', end: '2026-03-01T02:30' }))).toEqual([
      { weekOffset: 0, start: '2026-03-01T01:30', end: '2026-03-01T02:30' },
      { weekOffset: 1, start: '2026-03-08T01:30', end: '2026-03-08T03:30' },
    ]);
    expect(validateSquadEventSchedule(form({ weekly: true, occurrenceCount: 2, start: '2026-10-25T00:30', end: '2026-10-25T02:30' }), { now })).toBe('endInvalid');
  });
  it('allows a removed past base date when every retained date is future', () => {
    expect(validateSquadEventSchedule(form({ start: '2026-02-28T10:00', weekly: true, occurrenceCount: 2, excludedWeeks: [0] }), { now })).toBeNull();
  });
  it('validates every retained weekly date, while allowing removal of a gap occurrence', () => {
    const values = form({ start: '2026-03-01T02:30', weekly: true, occurrenceCount: 2 });
    expect(validateSquadEventSchedule(values, { now: Date.parse('2026-02-01Z') })).toBe('startInvalid');
    expect(validateSquadEventSchedule({ ...values, excludedWeeks: [1] }, { now: Date.parse('2026-02-01Z') })).toBeNull();
  });
});

it('does not settle identifiers from an older draft generation after discard or success', () => {
  const key = JSON.stringify(['account', 'parent', 'new']);
  const first = squadEventDraftIds(key, seqId);
  expect(settleSquadEventDraftIds(key, 'series', first, seqId)).toBe(true);
  const next = squadEventDraftIds(key, seqId);
  expect(settleSquadEventDraftIds(key, 'series', first, seqId)).toBe(false);
  expect(squadEventDraftIds(key, seqId)).toBe(next);
  resetSquadEventDraftIds();
});
