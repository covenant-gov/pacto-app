// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';

import CatchUpEntry from './CatchUpEntry.svelte';
import { pendingMlsWelcomes } from '../../stores/mls-chat';
import { squads, type Squad } from '../../stores/squads';
import { backendDmMessages } from '../../stores/dm';
import type { CatchUpEntry as CatchUpEntryType } from '../../lib/api/catch-up';
import { formatEventTimestampMs } from '../../lib/squad/squad-event-display';

vi.mock('../../stores/events-navigation', () => ({
  focusSquadEvent: vi.fn(),
  focusSquadEventSeries: vi.fn(),
}));

function welcomeEntry(overrides: Partial<CatchUpEntryType> = {}): CatchUpEntryType {
  return {
    kind: 'welcome',
    chatId: 'group-1',
    sourceEventId: 'ev-1',
    ...overrides,
  } as CatchUpEntryType;
}

describe('CatchUpEntry', () => {
  beforeEach(() => {
    pendingMlsWelcomes.set([]);
    squads.set([]);
    backendDmMessages.set({});
  });

  afterEach(() => {
    cleanup();
    pendingMlsWelcomes.set([]);
    squads.set([]);
    backendDmMessages.set({});
  });

  it('disables Accept when no matching pending welcome exists for the entry chatId', () => {
    render(CatchUpEntry, { props: { entry: welcomeEntry({ chatId: 'group-missing' }) } });
    const accept = screen.getByText('Accept').closest('button') as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
  });

  it('labels an event reminder by kind and fire time only', () => {
    squads.set([
      {
        id: 'squad-1',
        name: 'Crew',
        channels: [{ name: 'announcements', groupId: 'grp-ann', order: 0 }],
        kind: 'squad',
      } as unknown as Squad,
    ]);
    const fireAtMs = 1_767_224_700_000;
    render(CatchUpEntry, {
      props: {
        entry: {
          id: 'c1',
          kind: 'event_reminder',
          chatId: 'grp-ann',
          sourceEventId: `evt-1:${fireAtMs}`,
          createdAt: 0,
          resolvedAt: null,
        },
      },
    });
    expect(screen.getByText('Event reminder')).toBeTruthy();
    expect(screen.getByText(formatEventTimestampMs(fireAtMs, { locale: 'en' }))).toBeTruthy();
    expect((screen.getByText('Event reminder').closest('button') as HTMLButtonElement).disabled).toBe(false);
  });
});
