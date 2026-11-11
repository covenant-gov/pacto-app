// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

const acceptStagedChannelWelcome = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const acceptOfferedWelcome = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const resolveOneCatchUpEntry = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../lib/invites/accept-invite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/invites/accept-invite')>();
  return {
    ...actual,
    acceptStagedChannelWelcome: (...args: unknown[]) => acceptStagedChannelWelcome(...args),
  };
});

vi.mock('../../lib/invites/pending-welcomes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/invites/pending-welcomes')>();
  return {
    ...actual,
    acceptOfferedWelcome: (...args: unknown[]) => acceptOfferedWelcome(...args),
  };
});

vi.mock('../../stores/catch-up', () => ({
  resolveOneCatchUpEntry: (...args: unknown[]) => resolveOneCatchUpEntry(...args),
  hydrateCatchUpCount: vi.fn(),
}));

vi.mock('../../stores/events-navigation', () => ({
  focusSquadEvent: vi.fn(),
  focusSquadEventSeries: vi.fn(),
}));

import CatchUpEntry from './CatchUpEntry.svelte';
import { pendingMlsWelcomes } from '../../stores/mls-chat';
import { squads, type Squad } from '../../stores/squads';
import { backendDmMessages } from '../../stores/dm';
import type { CatchUpEntry as CatchUpEntryType } from '../../lib/api/catch-up';
import { formatEventTimestampMs } from '../../lib/squad/squad-event-display';
import { eventTimeFormat } from '../../stores/event-time-format';
import {
  resetPendingOpenChannelJoins,
  upsertPendingOpenChannelJoin,
} from '../../lib/squad/pending-open-channel-joins';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';

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
    setCurrentNpubForPersistence('npub1joiner');
    resetPendingOpenChannelJoins();
    acceptStagedChannelWelcome.mockReset().mockResolvedValue(undefined);
    acceptOfferedWelcome.mockReset().mockResolvedValue(undefined);
    resolveOneCatchUpEntry.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    eventTimeFormat.set('system');
    pendingMlsWelcomes.set([]);
    squads.set([]);
    backendDmMessages.set({});
    resetPendingOpenChannelJoins();
    setCurrentNpubForPersistence(null);
  });

  it('disables Accept when no matching pending welcome exists for the entry chatId', () => {
    render(CatchUpEntry, { props: { entry: welcomeEntry({ chatId: 'group-missing' }) } });
    const accept = screen.getByText('Accept').closest('button') as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
  });

  it.each(['system', '12h', '24h'] as const)('labels an event reminder by kind and fire time only in %s format', (clockFormat) => {
    eventTimeFormat.set(clockFormat);
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
    expect(screen.getByText(formatEventTimestampMs(fireAtMs, { locale: 'en', clockFormat }))).toBeTruthy();
    expect((screen.getByText('Event reminder').closest('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('accepts a wanted open-channel welcome as a channel, not a new squad', async () => {
    upsertPendingOpenChannelJoin({
      parentId: 'ann-gid',
      groupId: 'g-c1',
      name: 'c1',
      access: 'open',
    });
    pendingMlsWelcomes.set([
      {
        id: 'w-c1',
        wrapper_event_id: 'ev-1',
        nostr_group_id: 'g-c1',
        group_name: 'c1',
        group_description: null,
        group_admin_pubkeys: [],
        group_relays: [],
        welcomer: 'npub1admit',
        member_count: 2,
      },
    ]);
    render(CatchUpEntry, { props: { entry: welcomeEntry({ chatId: 'g-c1' }) } });
    await fireEvent.click(screen.getByText('Accept'));
    await vi.waitFor(() => {
      expect(acceptStagedChannelWelcome).toHaveBeenCalledWith({
        welcomeId: 'w-c1',
        channelGroupId: 'g-c1',
        parentId: 'ann-gid',
        channelName: 'c1',
        access: 'open',
      });
    });
    expect(acceptOfferedWelcome).not.toHaveBeenCalled();
  });
});
