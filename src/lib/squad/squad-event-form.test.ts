import { afterEach, describe, expect, it } from 'vitest';
import type { SquadEventDto } from '../api/squad-events';
import {
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

describe('per-squad draft ids', () => {
  afterEach(() => resetSquadEventDraftIds());

  it('survive reopening until the matching send succeeds', () => {
    const first = squadEventDraftIds('p1', seqId);
    // Close + reopen after a failed or unclear send: same ids.
    expect(squadEventDraftIds('p1', seqId)).toEqual(first);
    expect(squadEventDraftIds('p2', seqId).eventId).not.toBe(first.eventId);

    settleSquadEventDraftIds('p1', 'create', seqId);
    const afterCreate = squadEventDraftIds('p1', seqId);
    expect(afterCreate.eventId).not.toBe(first.eventId);
    expect(afterCreate.seriesId).toBe(first.seriesId);
    expect(afterCreate.seriesEventIds).toEqual(first.seriesEventIds);

    settleSquadEventDraftIds('p1', 'series', seqId);
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
