// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

import CreateEventModal from './CreateEventModal.svelte';
import { eventTimeFormat } from '../../stores/event-time-format';
import { currentUser } from '../../stores/auth-session';
import { squads, type Squad } from '../../stores/squads';
import type { SquadEventDto } from '../../lib/api/squad-events';
import { resetSquadEventDraftIds } from '../../lib/squad/squad-event-form';

beforeEach(() => { vi.setSystemTime(new Date('2026-11-06T12:00:00Z')); eventTimeFormat.set('system'); });

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  currentUser.set(null);
  invoke.mockReset();
  squads.set([]);
  resetSquadEventDraftIds();
});

async function fillAndSubmit(): Promise<void> {
  await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Standup' } });
  await fireEvent.input(screen.getByLabelText('Starts'), { target: { value: '2026-12-01T10:00' } });
  await fireEvent.input(screen.getByLabelText('Meeting link'), { target: { value: 'https://meet.example/a' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
}

function sentEventIds(): unknown[] {
  return invoke.mock.calls
    .filter(([cmd]) => cmd === 'send_squad_event_create')
    .map(([, args]) => (args && typeof args === 'object' && 'eventId' in args ? args.eventId : undefined));
}

describe('CreateEventModal', () => {
  it('reuses the minted event id after a failed send and a close/reopen, and mints a new one after success', async () => {
    squads.set([{ id: 'p', name: 'S', channels: [{ name: 'announcements', groupId: 'p', order: 0 }] } as Squad]);
    invoke.mockRejectedValueOnce('squad_event_create_restricted').mockResolvedValue(undefined);
    const props = { open: true, mlsGroupId: 'p', parentId: 'p', onclose: vi.fn() };

    const first = render(CreateEventModal, { props });
    await fillAndSubmit();
    await screen.findByText('Only squad admins can add events in this squad.');
    first.unmount();

    render(CreateEventModal, { props });
    await fillAndSubmit();
    await waitFor(() => expect(props.onclose).toHaveBeenCalled());
    cleanup();

    render(CreateEventModal, { props });
    await fillAndSubmit();
    await waitFor(() => expect(sentEventIds()).toHaveLength(3));
    const [failed, retried, next] = sentEventIds();
    expect(retried).toBe(failed);
    expect(next).not.toBe(retried);
  });
});


async function fillDraft() {
  await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Planning' } });
  await fireEvent.input(screen.getByLabelText('Starts'), { target: { value: '2026-12-01T23:30' } });
  await fireEvent.input(screen.getByLabelText('Meeting link'), { target: { value: 'https://example.com/meeting' } });
}

it('retains a selected duration across start changes and switches to custom after an end edit', async () => {
  render(CreateEventModal, { open: true, mlsGroupId: 'p', parentId: 'p', onclose: vi.fn() });
  await fillDraft();
  await fireEvent.click(screen.getByRole('button', { name: '90 minutes' }));
  expect((screen.getByLabelText('Ends (optional)') as HTMLInputElement).value).toBe('2026-12-02T01:00');
  expect(screen.getByRole('button', { name: '90 minutes' }).getAttribute('aria-pressed')).toBe('true');
  await fireEvent.input(screen.getByLabelText('Starts'), { target: { value: '2026-12-01T23:00' } });
  expect((screen.getByLabelText('Ends (optional)') as HTMLInputElement).value).toBe('2026-12-02T00:30');
  await fireEvent.input(screen.getByLabelText('Ends (optional)'), { target: { value: '2026-12-02T02:00' } });
  await fireEvent.input(screen.getByLabelText('Starts'), { target: { value: '2026-12-02T00:00' } });
  expect((screen.getByLabelText('Ends (optional)') as HTMLInputElement).value).toBe('2026-12-02T02:00');
  expect(screen.getByRole('button', { name: '90 minutes' }).getAttribute('aria-pressed')).toBe('false');
  await fireEvent.click(screen.getByLabelText('All day'));
  expect(screen.queryByRole('button', { name: '90 minutes' })).toBeNull();
});

it('sends exactly the retained weeks and reuses IDs on retry', async () => {
  invoke.mockRejectedValueOnce('offline').mockResolvedValue(undefined);
  render(CreateEventModal, { open: true, mlsGroupId: 'p', parentId: 'p', onclose: vi.fn() });
  await fillDraft();
  await fireEvent.click(screen.getByLabelText('Repeat weekly'));
  await fireEvent.input(screen.getByLabelText('Total occurrences (including the first)'), { target: { value: '4' } });
  const removeSecond = screen.getByRole('button', { name: 'Remove occurrence 2: 2026-12-08T23:30' });
  expect(removeSecond.textContent?.trim()).toBe('');
  expect(removeSecond.getAttribute('title')).toBe('Remove occurrence 2: 2026-12-08T23:30');
  expect(removeSecond.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  await fireEvent.click(removeSecond);
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  await screen.findByRole('alert');
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  const [command, args] = invoke.mock.calls[0];
  expect(command).toBe('send_squad_event_series');
  expect(args.weekOffsets).toEqual([0, 2, 3]);
  expect(args.eventIds).toHaveLength(3);
  expect(invoke.mock.calls[1][1]).toEqual(args);
});

it('disables an empty retained series and blocks a draft that becomes past before submission', async () => {
  render(CreateEventModal, { open: true, mlsGroupId: 'p', parentId: 'p', onclose: vi.fn() });
  await fillDraft();
  await fireEvent.click(screen.getByLabelText('Repeat weekly'));
  await fireEvent.input(screen.getByLabelText('Total occurrences (including the first)'), { target: { value: '1' } });
  await fireEvent.click(screen.getByRole('button', { name: /Remove occurrence 1/ }));
  expect((screen.getByRole('button', { name: 'Post event' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Keep at least one occurrence.')).toBeTruthy();
  await fireEvent.click(screen.getByLabelText('Repeat weekly'));
  vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
  await fireEvent.submit(screen.getByRole('button', { name: 'Post event' }).closest('form')!);
  await screen.findByText('Choose a start in the future.');
  expect(invoke).not.toHaveBeenCalled();
});


it('restores a failed series unchanged after reopening and leaves future validation to backend on exact retry', async () => {
  invoke.mockRejectedValueOnce('offline').mockResolvedValue(undefined);
  const props = { open: true, mlsGroupId: 'retry', parentId: 'retry', onclose: vi.fn() };
  const first = render(CreateEventModal, props);
  await fillDraft();
  await fireEvent.click(screen.getByLabelText('Repeat weekly'));
  await fireEvent.input(screen.getByLabelText('Total occurrences (including the first)'), { target: { value: '3' } });
  await fireEvent.click(screen.getByRole('button', { name: /Remove occurrence 1/ }));
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await screen.findByRole('alert');
  const original = invoke.mock.calls[0][1];
  expect(original.weekOffsets).toEqual([1, 2]);
  first.unmount();
  vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
  render(CreateEventModal, props);
  await screen.findByRole('status');
  expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Planning');
  expect(screen.getByLabelText('Title').closest('fieldset')?.disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Post event' }) as HTMLButtonElement).disabled).toBe(false);
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(invoke.mock.calls[1][1]).toEqual(original);
});

it('allows metadata edits of a historical event but validates rescheduling immediately', async () => {
  const editing = {
    id: 'old', title: 'History', summary: '', kind: 31923, startUnix: 1704103200, endUnix: 1704106800,
    startTzid: 'UTC', place: 'online', location: 'https://example.com', channelId: null,
  } as SquadEventDto;
  invoke.mockResolvedValue(undefined);
  render(CreateEventModal, { open: true, editing, mlsGroupId: 'old', parentId: 'old', onclose: vi.fn() });
  await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'New details' } });
  expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
  await fireEvent.input(screen.getByLabelText('Starts'), { target: { value: '2024-01-02T10:00' } });
  expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Choose a start in the future.')).toBeTruthy();
});

it('exposes all duration choices and requires a valid start before selecting one', async () => {
  render(CreateEventModal, { open: true, mlsGroupId: 'presets', parentId: 'presets', onclose: vi.fn() });
  expect(screen.getByRole('button', { name: '30 minutes' }).closest('fieldset')?.disabled).toBe(true);
  await fillDraft();
  for (const [minutes, end] of [[30, '2026-12-02T00:00'], [60, '2026-12-02T00:30'], [90, '2026-12-02T01:00'], [120, '2026-12-02T01:30']] as const) {
    await fireEvent.click(screen.getByRole('button', { name: `${minutes} minutes` }));
    expect((screen.getByLabelText('Ends (optional)') as HTMLInputElement).value).toBe(end);
    expect(screen.getByRole('button', { name: `${minutes} minutes` }).getAttribute('aria-pressed')).toBe('true');
  }
  await fireEvent.input(screen.getByLabelText('Ends (optional)'), { target: { value: '' } });
  expect((screen.getByLabelText('Ends (optional)') as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('button', { name: 'Post event' }) as HTMLButtonElement).disabled).toBe(false);
});


it('keeps failed meeting drafts within the account that created them', async () => {
  currentUser.set({ npub: 'account-a', pubkey: 'a' });
  invoke.mockRejectedValueOnce('offline').mockResolvedValue(undefined);
  const props = { open: true, mlsGroupId: 'shared', parentId: 'shared', onclose: vi.fn() };
  render(CreateEventModal, props);
  await fillDraft();
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await screen.findByRole('status');
  currentUser.set({ npub: 'account-b', pubkey: 'b' });
  await waitFor(() => expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(''));
  expect(screen.queryByRole('status')).toBeNull();
  currentUser.set({ npub: 'account-a', pubkey: 'a' });
  await screen.findByRole('status');
  expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Planning');
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
});


it('starts a fresh editable draft with new IDs after explicitly discarding a failed retry', async () => {
  invoke.mockRejectedValueOnce('offline').mockResolvedValue(undefined);
  render(CreateEventModal, { open: true, mlsGroupId: 'discard', parentId: 'discard', onclose: vi.fn() });
  await fillDraft();
  await fireEvent.click(screen.getByLabelText('Repeat weekly'));
  await fireEvent.input(screen.getByLabelText('Total occurrences (including the first)'), { target: { value: '2' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await screen.findByRole('status');
  const failed = invoke.mock.calls[0][1];
  await fireEvent.click(screen.getByRole('button', { name: 'Start a new draft' }));
  expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('');
  expect(screen.getByLabelText('Title').closest('fieldset')?.disabled).toBe(false);
  expect(screen.queryByRole('status')).toBeNull();
  await fillDraft();
  await fireEvent.click(screen.getByLabelText('Repeat weekly'));
  await fireEvent.input(screen.getByLabelText('Total occurrences (including the first)'), { target: { value: '2' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  const fresh = invoke.mock.calls[1][1];
  expect(fresh.seriesId).not.toBe(failed.seriesId);
  expect(fresh.eventIds.every((id: string) => !failed.eventIds.includes(id))).toBe(true);
});

async function selectRetainedSeries(): Promise<void> {
  await fillDraft();
  await fireEvent.click(screen.getByLabelText('Repeat weekly'));
  await fireEvent.input(screen.getByLabelText('Total occurrences (including the first)'), { target: { value: '4' } });
  await fireEvent.click(screen.getByRole('button', { name: /Remove occurrence 2/ }));
}

it('preserves A partial publication IDs after B publishes and settles the same squad', async () => {
  const landed = new Set<string>();
  let first = true;
  invoke.mockImplementation(async (_command, args) => {
    if (first) {
      first = false;
      landed.add(args.eventIds[0]);
      throw new Error('partial publication');
    }
    for (const id of args.eventIds) landed.add(id);
  });
  const props = { open: true, mlsGroupId: 'shared-series', parentId: 'shared-series', onclose: vi.fn() };
  currentUser.set({ npub: 'series-a', pubkey: 'a' });
  render(CreateEventModal, props);
  await selectRetainedSeries();
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await screen.findByRole('status');
  const originalA = structuredClone(invoke.mock.calls[0][1]);
  currentUser.set({ npub: 'series-b', pubkey: 'b' });
  await waitFor(() => expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(''));
  await selectRetainedSeries();
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await waitFor(() => expect(props.onclose).toHaveBeenCalledTimes(1));
  const originalB = invoke.mock.calls[1][1];
  currentUser.set({ npub: 'series-a', pubkey: 'a' });
  await screen.findByRole('status');
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await waitFor(() => expect(props.onclose).toHaveBeenCalledTimes(2));
  expect(originalA.weekOffsets).toEqual([0, 2, 3]);
  expect(originalB.seriesId).not.toBe(originalA.seriesId);
  expect(invoke.mock.calls[2][1]).toEqual(originalA);
  expect(landed.size).toBe(6);
});

it('does not settle B retry IDs when an earlier A publication finishes after switching accounts', async () => {
  let finishA!: () => void;
  const pendingA = new Promise<void>((resolve) => { finishA = resolve; });
  invoke.mockImplementationOnce(() => pendingA).mockRejectedValueOnce('offline').mockResolvedValue(undefined);
  const props = { open: true, mlsGroupId: 'async-shared', parentId: 'async-shared', onclose: vi.fn() };
  currentUser.set({ npub: 'async-a', pubkey: 'a' });
  render(CreateEventModal, props);
  await selectRetainedSeries();
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  currentUser.set({ npub: 'async-b', pubkey: 'b' });
  await waitFor(() => expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(''));
  await selectRetainedSeries();
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await screen.findByRole('status');
  const originalB = structuredClone(invoke.mock.calls[1][1]);
  finishA();
  await pendingA;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
  expect(invoke.mock.calls[2][1]).toEqual(originalB);
  expect(props.onclose).toHaveBeenCalledTimes(1);
});

it('restores an in-flight A draft as busy after switching away and back', async () => {
  let finish!: () => void;
  invoke.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  currentUser.set({ npub: 'pending-a', pubkey: 'a' });
  const props = { open: true, mlsGroupId: 'pending', parentId: 'pending', onclose: vi.fn() };
  render(CreateEventModal, props);
  await selectRetainedSeries();
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  currentUser.set({ npub: 'pending-b', pubkey: 'b' });
  await waitFor(() => expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(''));
  currentUser.set({ npub: 'pending-a', pubkey: 'a' });
  await waitFor(() => expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Planning'));
  expect((screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByLabelText('Title').closest('fieldset')?.disabled).toBe(true);
  expect(invoke).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() => expect(props.onclose).toHaveBeenCalledOnce());
});


it('settles an unmounted A draft without closing the currently mounted B modal', async () => {
  let finishA!: () => void;
  const pendingA = new Promise<void>((resolve) => { finishA = resolve; });
  invoke.mockImplementationOnce(() => pendingA).mockRejectedValueOnce('offline').mockResolvedValue(undefined);
  const onclose = vi.fn();
  const props = { open: true, mlsGroupId: 'unmounted', parentId: 'unmounted', onclose };
  currentUser.set({ npub: 'unmounted-a', pubkey: 'a' });
  const first = render(CreateEventModal, props);
  await selectRetainedSeries();
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  first.unmount();
  currentUser.set({ npub: 'unmounted-b', pubkey: 'b' });
  render(CreateEventModal, props);
  await selectRetainedSeries();
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await screen.findByRole('status');
  const originalB = structuredClone(invoke.mock.calls[1][1]);
  finishA();
  await pendingA;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(onclose).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await waitFor(() => expect(onclose).toHaveBeenCalledOnce());
  expect(invoke.mock.calls[2][1]).toEqual(originalB);
});

it('unlocks a remounted pending draft when its original request completes', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  invoke.mockImplementationOnce(() => pending);
  currentUser.set({ npub: 'remounted-a', pubkey: 'a' });
  const props = { open: true, mlsGroupId: 'remounted', parentId: 'remounted', onclose: vi.fn() };
  const first = render(CreateEventModal, props);
  await selectRetainedSeries();
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  first.unmount();
  render(CreateEventModal, props);
  await screen.findByRole('button', { name: 'Saving…' });
  finish();
  await pending;
  await waitFor(() => expect(screen.getByLabelText('Title').closest('fieldset')?.disabled).toBe(false));
  expect(props.onclose).not.toHaveBeenCalled();
});

it('switches explicit clock formats without changing the schedule, presets, or retained weeks', async () => {
  const { eventTimeFormat } = await import('../../stores/event-time-format');
  render(CreateEventModal, { open: true, mlsGroupId: 'clock-format', parentId: 'clock-format', onclose: vi.fn() });
  await fillDraft();
  await fireEvent.click(screen.getByRole('button', { name: '90 minutes' }));
  await fireEvent.click(screen.getByLabelText('Repeat weekly'));
  await fireEvent.input(screen.getByLabelText('Total occurrences (including the first)'), { target: { value: '3' } });
  await fireEvent.click(screen.getByRole('button', { name: /Remove occurrence 2/ }));
  eventTimeFormat.set('12h');
  await waitFor(() => expect((screen.getByLabelText('Starts: Hour') as HTMLInputElement).value).toBe('11'));
  expect((screen.getByLabelText('Starts: AM/PM') as HTMLSelectElement).value).toBe('PM');
  expect((screen.getByLabelText('Ends (optional): Hour') as HTMLInputElement).value).toBe('1');
  expect((screen.getByLabelText('Ends (optional): AM/PM') as HTMLSelectElement).value).toBe('AM');
  expect(screen.getByRole('button', { name: '90 minutes' }).getAttribute('aria-pressed')).toBe('true');
  eventTimeFormat.set('24h');
  await waitFor(() => expect((screen.getByLabelText('Starts: Hour') as HTMLInputElement).value).toBe('23'));
  expect(screen.queryByLabelText('Starts: AM/PM')).toBeNull();
  invoke.mockResolvedValue(undefined);
  await fireEvent.click(screen.getByRole('button', { name: 'Post event' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  expect(invoke.mock.calls[0][1].event.start).toBe('2026-12-01T23:30');
  expect(invoke.mock.calls[0][1].event.end).toBe('2026-12-02T01:00');
  expect(invoke.mock.calls[0][1].weekOffsets).toEqual([0, 2]);
  eventTimeFormat.set('system');
});

it('shows separately labeled preview start, end, duration, and clear optional end', async () => {
  const { eventTimeFormat } = await import('../../stores/event-time-format');
  eventTimeFormat.set('system');
  render(CreateEventModal, { open: true, mlsGroupId: 'clock-preview', parentId: 'clock-preview', onclose: vi.fn() });
  await fillDraft();
  await fireEvent.click(screen.getByRole('button', { name: '90 minutes' }));
  const preview = screen.getByRole('region', { name: 'Dates to schedule' });
  expect(preview.querySelectorAll('.occurrence-field')).toHaveLength(2);
  expect(preview.textContent).toContain('Duration:');
  expect(preview.textContent).toMatch(/1 hr.? 30 min/);
  eventTimeFormat.set('12h');
  await waitFor(() => expect(screen.getByLabelText('Ends (optional): Date')).toBeTruthy());
  await fireEvent.input(screen.getByLabelText('Ends (optional): Date'), { target: { value: '' } });
  expect(preview.textContent).toContain('No end');
  expect(preview.textContent).toContain('Duration unspecified');
  eventTimeFormat.set('system');
});
