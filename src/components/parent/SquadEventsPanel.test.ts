// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { SquadEventDto } from '../../lib/api/squad-events';
import type { SquadContentPolicyView } from '../../lib/api/squad-content-policy';

const state = vi.hoisted(() => ({
  events: [] as unknown[],
  policy: null as unknown,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((command: string) => {
    if (command === 'list_squad_events') return Promise.resolve(state.events);
    if (command === 'get_squad_content_policy') return Promise.resolve(state.policy);
    if (command === 'get_squad_event_reminder_prefs') return Promise.resolve({ leadMinutes: 15, muted: false });
    return Promise.resolve(null);
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

import SquadEventsPanel from './SquadEventsPanel.svelte';
import { eventsFocus } from '../../stores/events-navigation';

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

function policy(overrides: Partial<SquadContentPolicyView> = {}): SquadContentPolicyView {
  return {
    restrictEventCreate: false,
    restrictEventCreateUpdatedAtMs: 0,
    restrictDocAdd: false,
    restrictDocAddUpdatedAtMs: 0,
    callerIsAdmin: false,
    adminIsMember: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  eventsFocus.set(null);
});

describe('SquadEventsPanel', () => {
  it("opens the clicked card's event detail", async () => {
    state.events = [ev('e1', 'Standup'), ev('e2', 'Retro')];
    state.policy = policy();
    render(SquadEventsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await fireEvent.click(await screen.findByRole('button', { name: 'Open event Retro' }));
    const detail = await screen.findByRole('region', { name: 'Event details' });
    expect(detail.textContent).toContain('Retro');
    expect(detail.textContent).not.toContain('Standup');
  });

  it('opens the focused event from a deep link', async () => {
    state.events = [ev('e1', 'Standup'), ev('e2', 'Retro')];
    state.policy = policy();
    eventsFocus.set({ parentId: 'p', eventId: 'e1', seriesId: null });
    render(SquadEventsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    const detail = await screen.findByRole('region', { name: 'Event details' });
    expect(detail.textContent).toContain('Standup');
  });

  it('has no create control when restricted and the caller is not an admin', async () => {
    state.events = [];
    state.policy = policy({ restrictEventCreate: true });
    render(SquadEventsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await screen.findByText('Only squad admins can add events.');
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull();
  });

  it('says nobody can add when no admin is still a member', async () => {
    state.events = [];
    state.policy = policy({ restrictEventCreate: true, adminIsMember: false });
    render(SquadEventsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await screen.findByText(/Nobody can add events/);
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull();
  });

  it('shows the create control and the join-history empty copy when open', async () => {
    state.events = [];
    state.policy = policy();
    render(SquadEventsPanel, { props: { parentId: 'p', mlsGroupId: 'g' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add event' })).toBeTruthy());
    expect(screen.getByText(/before you joined/)).toBeTruthy();
  });
});
