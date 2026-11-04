// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

import CreateEventModal from './CreateEventModal.svelte';
import { squads, type Squad } from '../../stores/squads';
import { resetSquadEventDraftIds } from '../../lib/squad/squad-event-form';

afterEach(() => {
  cleanup();
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
