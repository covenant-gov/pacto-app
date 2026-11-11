// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { SquadEventDto } from '../../lib/api/squad-events';

const state = vi.hoisted(() => ({
  events: [] as unknown[],
  canCreate: true,
  rpcFails: false,
  privilege: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((command: string) => {
    if (command === 'list_squad_events') return Promise.resolve(state.events);
    if (command === 'get_squad_event_reminder_prefs') return Promise.resolve({ leadMinutes: 15, muted: false });
    return Promise.resolve(null);
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('../../lib/governance/squad-privilege-enforce', () => ({
  requireMySquadPrivilege: state.privilege,
}));

import SquadEventsPanel from './SquadEventsPanel.svelte';
import { bumpSquadPrivilegeNonce, squadPrivilegeNonceByParentId } from '../../stores/squad-privilege-refresh';
import { eventsFocus } from '../../stores/events-navigation';
import { eventTimeFormat } from '../../stores/event-time-format';
import { formatEventStart } from '../../lib/squad/squad-event-display';

function ev(id: string, title: string): SquadEventDto {
  return {
    id,
    parentId: 'p',
    mlsGroupId: 'g',
    seriesId: null,
    kind: 31923,
    title,
    summary: '',
    startUnix: Math.floor(Date.now() / 1000) + 86_400,
    endUnix: null,
    startDate: null,
    endDate: null,
    startTzid: 'UTC',
    place: 'online',
    location: 'https://meet.example/x',
    channelId: 'g',
    status: 'active',
    authorNpub: 'npub1a',
    createdAtMs: 0,
    updatedAtMs: 0,
    updatedByNpub: 'npub1a',
    rsvps: [],
    myRsvp: null,
    canEdit: false,
  };
}

beforeEach(() => {
  state.rpcFails = false;
  state.privilege.mockReset().mockImplementation(async () => {
    if (state.rpcFails) return { ok: false, reason: 'rpc', active: true };
    return state.canCreate
      ? { ok: true, active: false, flags: null }
      : { ok: false, reason: 'denied', active: true };
  });
  squadPrivilegeNonceByParentId.set({});
});

afterEach(() => {
  cleanup();
  eventTimeFormat.set('system');
  eventsFocus.set(null);
});

describe('SquadEventsPanel', () => {
  it('shares the selected clock with event cards and details and shows duration', async () => {
    const meeting = { ...ev('timed', 'Planning'), startUnix: Date.UTC(2027, 0, 2, 12) / 1000,
      endUnix: Date.UTC(2027, 0, 2, 13, 30) / 1000 };
    state.events = [meeting];
    state.canCreate = true;
    render(SquadEventsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    const card = await screen.findByRole('button', { name: 'Open event Planning' });
    await fireEvent.change(screen.getByRole('combobox', { name: 'Time format' }), { target: { value: '12h' } });
    expect(card.textContent).toContain(formatEventStart(meeting, { locale: 'en', clockFormat: '12h' }));
    expect(card.textContent).toContain('1 hr 30 min');
    await fireEvent.change(screen.getByRole('combobox', { name: 'Time format' }), { target: { value: '24h' } });
    expect(card.textContent).toContain(formatEventStart(meeting, { locale: 'en', clockFormat: '24h' }));
    await fireEvent.click(card);
    const detail = await screen.findByRole('region', { name: 'Event details' });
    expect(detail.textContent).toContain('1 hr 30 min');
    expect(detail.textContent).toContain(formatEventStart(meeting, { locale: 'en', clockFormat: '24h' }));
  });

  it('shows duration unspecified when the event has no end', async () => {
    state.events = [ev('e1', 'No end')];
    state.canCreate = true;
    render(SquadEventsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    expect((await screen.findByRole('button', { name: 'Open event No end' })).textContent).toContain('Duration unspecified');
  });

  it("opens the clicked card's event detail", async () => {
    state.events = [ev('e1', 'Standup'), ev('e2', 'Retro')];
    state.canCreate = true;
    render(SquadEventsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await fireEvent.click(await screen.findByRole('button', { name: 'Open event Retro' }));
    const detail = await screen.findByRole('region', { name: 'Event details' });
    expect(detail.textContent).toContain('Retro');
    expect(detail.textContent).not.toContain('Standup');
  });

  it('opens the focused event from a deep link', async () => {
    state.events = [ev('e1', 'Standup'), ev('e2', 'Retro')];
    state.canCreate = true;
    eventsFocus.set({ parentId: 'p', eventId: 'e1', seriesId: null });
    render(SquadEventsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    const detail = await screen.findByRole('region', { name: 'Event details' });
    expect(detail.textContent).toContain('Standup');
  });

  it('has no create control when the privilege is denied', async () => {
    state.events = [];
    state.canCreate = false;
    render(SquadEventsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await screen.findByText('You cannot add events.');
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull();
  });

  it('keeps the create control offered when the privilege read fails', async () => {
    state.events = [];
    state.canCreate = true;
    state.rpcFails = true;
    render(SquadEventsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add event' })).toBeTruthy());
    expect(screen.queryByText('You cannot add events.')).toBeNull();
  });

  it('re-reads the privilege after a local role change', async () => {
    state.events = [];
    state.canCreate = true;
    render(SquadEventsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add event' })).toBeTruthy());
    expect(state.privilege).toHaveBeenCalledTimes(1);

    state.canCreate = false;
    bumpSquadPrivilegeNonce('p');
    await screen.findByText('You cannot add events.');
    expect(state.privilege).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull();
  });

  it('shows the create control and the join-history empty copy when open', async () => {
    state.events = [];
    state.canCreate = true;
    render(SquadEventsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add event' })).toBeTruthy());
    expect(screen.getByText(/before you joined/)).toBeTruthy();
  });
});
