// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AnnounceCard from './AnnounceCard.svelte';
import {
  ANNOUNCE_TYPE_SAFE_UPDATED,
  ANNOUNCE_TYPE_SAFE_PROPOSAL,
  ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE,
  ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
  ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
  ANNOUNCE_TYPE_WAR_GAME_UPDATED,
  ANNOUNCE_TYPE_STICKER_PACK_UPDATED,
  ANNOUNCE_TYPE_SQUAD_EVENT_CREATED,
  ANNOUNCE_TYPE_SQUAD_EVENT_SERIES_CREATED,
  ANNOUNCE_TYPE_SQUAD_DOC_ADDED,
  parseAnnouncement,
  type AnnounceMessage,
} from '../../lib/announcements';
import type { SquadEventDto } from '../../lib/api/squad-events';
import type * as SquadEventsApi from '../../lib/api/squad-events';
import type * as SquadEventDisplay from '../../lib/squad/squad-event-display';
import { squads, type Squad } from '../../stores/squads';
import { eventTimeFormat } from '../../stores/event-time-format';

const mocks = vi.hoisted(() => ({
  listSquadEvents: vi.fn(),
  focusSquadEvent: vi.fn(),
  focusSquadEventSeries: vi.fn(),
  openSquadDocs: vi.fn(),
  requestLinkPreview: vi.fn(),
  /** Minimal readable store: no replica updates during a test. */
  replicaNonce: {
    subscribe(run: (v: Record<string, number>) => void) {
      run({});
      return () => {};
    },
  },
}));

vi.mock('@tauri-apps/api/core');
vi.mock('../../lib/api/squad-events', async (importOriginal) => ({
  ...(await importOriginal<typeof SquadEventsApi>()),
  listSquadEvents: mocks.listSquadEvents,
}));
vi.mock('../../stores/events-navigation', () => ({
  focusSquadEvent: mocks.focusSquadEvent,
  focusSquadEventSeries: mocks.focusSquadEventSeries,
}));
vi.mock('../../stores/docs-navigation', () => ({
  openSquadDocs: mocks.openSquadDocs,
}));
vi.mock('../../stores/events-hub-alerts', () => ({
  squadEventReplicaNonceByParentId: mocks.replicaNonce,
}));
vi.mock('../../lib/messaging/link-preview', () => ({
  requestLinkPreview: mocks.requestLinkPreview,
  clearLinkPreviewRequests: vi.fn(),
}));
vi.mock('../../lib/squad/squad-event-display', async (importOriginal) => ({
  ...(await importOriginal<typeof SquadEventDisplay>()),
  viewerTimeZone: () => 'America/Los_Angeles',
}));

afterEach(() => {
  cleanup();
  squads.set([]);
  eventTimeFormat.set('system');
});

/** Replica reads are cached per parent, so each test uses its own parent id. */
let parentSeq = 0;

function eventRow(parentId: string, overrides: Partial<SquadEventDto> = {}): SquadEventDto {
  return {
    id: 'evt-1',
    parentId,
    mlsGroupId: 'grp-ann',
    seriesId: null,
    kind: 31923,
    title: 'Standup',
    summary: '',
    startUnix: 1_767_225_600,
    endUnix: null,
    startDate: null,
    endDate: null,
    startTzid: 'America/New_York',
    place: 'offline',
    location: '123 Secret Street',
    channelId: 'grp-ann',
    status: 'active',
    authorNpub: 'npub1author',
    createdAtMs: 0,
    updatedAtMs: 0,
    updatedByNpub: 'npub1author',
    rsvps: [],
    myRsvp: null,
    canEdit: false,
    ...overrides,
  };
}

describe('AnnounceCard squad event cards', () => {
  let parentId: string;

  beforeEach(() => {
    parentId = `squad-ev-${++parentSeq}`;
    mocks.listSquadEvents
      .mockReset()
      .mockImplementation(async () => [
        eventRow(parentId),
        eventRow(parentId, { id: 'evt-s', seriesId: 'series-1' }),
      ]);
    mocks.focusSquadEvent.mockReset();
    mocks.focusSquadEventSeries.mockReset();
    mocks.requestLinkPreview.mockReset();
    squads.set([
      {
        id: parentId,
        name: 'Crew',
        channels: [{ name: 'announcements', groupId: 'grp-ann', order: 0 }],
        kind: 'squad',
      } as unknown as Squad,
    ]);
  });

  function singleCard(payload: Record<string, unknown> = {}): AnnounceMessage {
    const parsed = parseAnnouncement(
      JSON.stringify({
        type: ANNOUNCE_TYPE_SQUAD_EVENT_CREATED,
        payload: {
          id: 'evt-1',
          parent_id: parentId,
          series_id: null,
          kind: 31923,
          title: 'Standup',
          start: 1_767_225_600,
          end: null,
          start_tzid: 'America/New_York',
          channel_id: 'grp-ann',
          location: '123 Secret Street',
          ...payload,
        },
      }),
    );
    if (!parsed) throw new Error('fixture did not parse');
    return parsed;
  }

  function seriesCard(): AnnounceMessage {
    return {
      type: ANNOUNCE_TYPE_SQUAD_EVENT_SERIES_CREATED,
      payload: {
        series_id: 'series-1',
        parent_id: parentId,
        kind: 31923,
        title: 'Weekly sync',
        first_start: 1_767_225_600,
        start_tzid: 'America/Los_Angeles',
        count: 8,
        channel_id: null,
      },
    };
  }

  it('renders title, channel, author, and no location even when the JSON carries one', async () => {
    mocks.listSquadEvents.mockResolvedValue([eventRow(parentId)]);
    const { container } = render(AnnounceCard, {
      props: { announce: singleCard(), authorName: 'Alice', timestamp: '' },
    });
    expect(screen.getByText('Standup')).toBeTruthy();
    expect(screen.getByText('#announcements')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    await vi.waitFor(() => expect(mocks.listSquadEvents).toHaveBeenCalledWith(parentId));
    expect(container.innerHTML).not.toContain('Secret');
  });

  it('reacts to clock preference and shows the latest duration in a single-event announcement', async () => {
    mocks.listSquadEvents.mockResolvedValue([eventRow(parentId, {
      startUnix: Date.UTC(2027, 0, 2, 20) / 1000,
      endUnix: Date.UTC(2027, 0, 2, 21, 30) / 1000,
    })]);
    eventTimeFormat.set('12h');
    const { container } = render(AnnounceCard, { props: { announce: singleCard(), authorName: 'Alice', timestamp: '' } });
    expect(await screen.findByText('1 hr 30 min')).toBeTruthy();
    expect(container.querySelector('.event-announce-start')?.textContent).toContain('12:00 PM');
    eventTimeFormat.set('24h');
    await vi.waitFor(() => expect(container.querySelector('.event-announce-start')?.textContent).toContain('12:00'));
    expect(container.querySelector('.event-announce-start')?.textContent).not.toContain('PM');
  });

  it('uses the selected clock in series announcements', async () => {
    eventTimeFormat.set('24h');
    const { container } = render(AnnounceCard, { props: { announce: seriesCard(), authorName: 'Alice', timestamp: '' } });
    expect(container.querySelector('.event-announce-start')?.textContent).toContain('16:00');
    expect(container.querySelector('.event-announce-start')?.textContent).not.toContain('PM');
    eventTimeFormat.set('12h');
    await vi.waitFor(() => expect(container.querySelector('.event-announce-start')?.textContent).toContain('4:00 PM'));
  });

  it('adds the cancelled label from the replica without a second message', async () => {
    mocks.listSquadEvents.mockResolvedValue([eventRow(parentId, { status: 'cancelled' })]);
    render(AnnounceCard, { props: { announce: singleCard(), authorName: 'Alice', timestamp: '' } });
    expect(await screen.findByText('Cancelled')).toBeTruthy();
  });

  it('shows the edited title from the replica', async () => {
    mocks.listSquadEvents.mockResolvedValue([eventRow(parentId, { title: 'Standup moved' })]);
    render(AnnounceCard, { props: { announce: singleCard(), authorName: 'Alice', timestamp: '' } });
    expect(await screen.findByText('Standup moved')).toBeTruthy();
  });

  it('shows the event zone when it differs from the viewer zone', () => {
    const { container } = render(AnnounceCard, {
      props: { announce: singleCard(), authorName: 'Alice', timestamp: '' },
    });
    expect(container.textContent).toContain('(America/New_York)');
  });

  it('omits the event zone when it matches the viewer zone', () => {
    const { container } = render(AnnounceCard, {
      props: { announce: singleCard({ start_tzid: 'America/Los_Angeles' }), authorName: 'Alice', timestamp: '' },
    });
    expect(container.textContent).not.toContain('(America/Los_Angeles)');
    expect(container.querySelector('.event-announce-zone')).toBeNull();
  });

  it('renders an all-day civil date unshifted for a Pacific viewer', () => {
    const { container } = render(AnnounceCard, {
      props: {
        announce: singleCard({ kind: 31922, start: '2026-03-08', end: null }),
        authorName: 'Alice',
        timestamp: '',
      },
    });
    expect(container.textContent).toContain('March 8, 2026');
    expect(container.querySelector('.event-announce-zone')).toBeNull();
  });

  it('opens the event detail on activation and never requests a link preview', async () => {
    render(AnnounceCard, { props: { announce: singleCard(), authorName: 'Alice', timestamp: '' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Open event Standup' }));
    expect(mocks.focusSquadEvent).toHaveBeenCalledWith(parentId, 'evt-1');
    expect(mocks.focusSquadEventSeries).not.toHaveBeenCalled();
    expect(mocks.requestLinkPreview).not.toHaveBeenCalled();
  });

  it('shows the active count of a series with one cancelled occurrence', async () => {
    mocks.listSquadEvents.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) =>
        eventRow(parentId, { id: `evt-${i}`, seriesId: 'series-1', status: i === 3 ? 'cancelled' : 'active' }),
      ),
    );
    render(AnnounceCard, { props: { announce: seriesCard(), authorName: 'Alice', timestamp: '' } });
    expect(screen.getByText('Weekly sync')).toBeTruthy();
    expect(await screen.findByText(/7 of 8 active/)).toBeTruthy();
    expect(screen.getByText(/8 weekly meetings/)).toBeTruthy();
  });

  it('opens #events filtered by series on series activation, not a single event', async () => {
    render(AnnounceCard, { props: { announce: seriesCard(), authorName: 'Alice', timestamp: '' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Open weekly meetings Weekly sync' }));
    expect(mocks.focusSquadEventSeries).toHaveBeenCalledWith(parentId, 'series-1');
    expect(mocks.focusSquadEvent).not.toHaveBeenCalled();
    expect(mocks.requestLinkPreview).not.toHaveBeenCalled();
  });

  it('marks a single card unavailable and disables it when the loaded replica has no row', async () => {
    mocks.listSquadEvents.mockResolvedValue([eventRow(parentId, { id: 'other' })]);
    render(AnnounceCard, { props: { announce: singleCard(), authorName: 'Alice', timestamp: '' } });
    expect(await screen.findByText('No longer available')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Open event Standup' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await fireEvent.click(button);
    expect(mocks.focusSquadEvent).not.toHaveBeenCalled();
  });

  it('keeps the stored card active when the replica read fails', async () => {
    mocks.listSquadEvents.mockRejectedValue(new Error('offline'));
    render(AnnounceCard, { props: { announce: singleCard(), authorName: 'Alice', timestamp: '' } });
    await vi.waitFor(() => expect(mocks.listSquadEvents).toHaveBeenCalledWith(parentId));
    await Promise.resolve();
    expect(screen.queryByText('No longer available')).toBeNull();
    expect((screen.getByRole('button', { name: 'Open event Standup' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('marks a series card unavailable when none of its occurrences are in the loaded replica', async () => {
    mocks.listSquadEvents.mockResolvedValue([eventRow(parentId)]);
    render(AnnounceCard, { props: { announce: seriesCard(), authorName: 'Alice', timestamp: '' } });
    expect(await screen.findByText('No longer available')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Open weekly meetings Weekly sync' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('AnnounceCard squad doc card', () => {
  beforeEach(() => {
    mocks.openSquadDocs.mockReset();
    mocks.requestLinkPreview.mockReset();
    squads.set([
      {
        id: 'squad-doc',
        name: 'Crew',
        channels: [
          { name: 'announcements', groupId: 'grp-ann', order: 0 },
          { name: 'ops', groupId: 'grp-ops', order: 4 },
        ],
        kind: 'squad',
      } as unknown as Squad,
    ]);
  });

  function docCard(payload: Record<string, unknown> = {}): AnnounceMessage {
    const parsed = parseAnnouncement(
      JSON.stringify({
        type: ANNOUNCE_TYPE_SQUAD_DOC_ADDED,
        payload: {
          id: 'doc-1',
          parent_id: 'squad-doc',
          title: 'Agenda',
          provider: 'cryptpad',
          channel_id: 'grp-ops',
          display_url: 'https://cryptpad.fr/pad/#/2/pad/edit/secret',
          note: 'private note',
          ...payload,
        },
      }),
    );
    if (!parsed) throw new Error('fixture did not parse');
    return parsed;
  }

  it('renders title, provider, channel, author, and the masked URL without the fragment or note', () => {
    const { container } = render(AnnounceCard, {
      props: { announce: docCard(), authorName: 'Alice', timestamp: '' },
    });
    expect(screen.getByText('Agenda')).toBeTruthy();
    expect(screen.getByText('CryptPad')).toBeTruthy();
    expect(screen.getByText('#ops')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('https://cryptpad.fr/pad/#••••')).toBeTruthy();
    expect(container.innerHTML).not.toContain('secret');
    expect(container.innerHTML).not.toContain('private note');
  });

  it('has no reveal or copy control and never requests a link preview', async () => {
    render(AnnounceCard, { props: { announce: docCard(), authorName: 'Alice', timestamp: '' } });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Open Agenda in Docs' }));
    expect(mocks.openSquadDocs).toHaveBeenCalledWith('squad-doc', { docId: 'doc-1' });
    expect(mocks.requestLinkPreview).not.toHaveBeenCalled();
  });

  it('does not import the link preview module', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'DocAddedAnnounceBody.svelte'), 'utf8');
    expect(source).not.toMatch(/link-preview/);
  });
});

describe('AnnounceCard routing', () => {
  it('renders a dashboard poll body for dashboard_poll_created', () => {
    const announce: AnnounceMessage = {
      type: ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
      payload: { parent_id: 'squad-1', poll_id: 'poll-1', title: 'Pick a treasurer', options: [] },
    };
    render(AnnounceCard, { props: { announce, authorName: 'Alice', timestamp: '' } });
    expect(screen.getByText('Pick a treasurer')).toBeTruthy();
  });

  it('renders a signer-share body for squad_member_evm_share', () => {
    const announce: AnnounceMessage = {
      type: ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE,
      payload: {
        parent_id: 'squad-1',
        member_npub: 'npub1alice',
        evm_address: '0x1111111111111111111111111111111111111111',
        issued_at: 1710000000,
        signature: `0x${'ab'.repeat(65)}`,
      },
    };
    render(AnnounceCard, { props: { announce, authorName: 'Alice', authorNpub: 'npub1alice', timestamp: '' } });
    expect(screen.getByTitle('0x1111111111111111111111111111111111111111')).toBeTruthy();
  });

  it('renders a Safe body for safe_updated', () => {
    const announce: AnnounceMessage = {
      type: ANNOUNCE_TYPE_SAFE_UPDATED,
      payload: { squad_id: 'squad-1', safe_address: '0x2222222222222222222222222222222222222222', chain: 'sepolia' },
    };
    render(AnnounceCard, { props: { announce, authorName: 'Bob', timestamp: '' } });
    expect(screen.getByText('Safe address updated')).toBeTruthy();
  });

  it('renders a Safe body for safe_proposal', () => {
    const announce: AnnounceMessage = {
      type: ANNOUNCE_TYPE_SAFE_PROPOSAL,
      payload: {
        id: 'p1',
        parent_id: 'squad-1',
        to: '0x3333333333333333333333333333333333333',
        amount: '1.5',
        token: 'ETH',
        proposer_npub: 'npub1bob',
      },
    };
    render(AnnounceCard, { props: { announce, authorName: 'Bob', timestamp: '' } });
    expect(screen.getByText('Safe proposal')).toBeTruthy();
  });

  it('routes governance_updated with provider pacto_gov to the Pacto Gov deploy body', () => {
    const announce: AnnounceMessage = {
      type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
      payload: { parent_id: 'squad-1', provider: 'pacto_gov', canonical_ref: '0xhat' },
    };
    render(AnnounceCard, { props: { announce, authorName: 'Carol', timestamp: '' } });
    expect(screen.getByText('Carol deployed Pacto Gov')).toBeTruthy();
  });

  it('routes governance_updated with a non-pacto_gov provider to the generic governance body', () => {
    const announce: AnnounceMessage = {
      type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
      payload: { parent_id: 'squad-1', provider: 'gnosis_safe', canonical_ref: '0xsafe' },
    };
    render(AnnounceCard, { props: { announce, authorName: 'Dana', timestamp: '' } });
    expect(screen.getByText('Dana linked a treasury Safe')).toBeTruthy();
  });

  it('routes war_game_updated to the war-game body', () => {
    const announce: AnnounceMessage = {
      type: ANNOUNCE_TYPE_WAR_GAME_UPDATED,
      payload: {
        parent_id: 'squad-1',
        action: 'deploy',
        canonical_ref: '0xhat',
        chain: 'sepolia',
        entry_id: 'entry-1',
        round: '1',
        game_squad_id: '0xgame',
        sponsor: '0xsponsor',
        provider_payload: '{}',
      },
    };
    render(AnnounceCard, { props: { announce, authorName: 'Eve', timestamp: '' } });
    expect(screen.getByText('Eve started a war-game round')).toBeTruthy();
    expect(screen.getByText('Round 1')).toBeTruthy();
  });

  it('falls back to the generic body for an announce type it does not special-case', () => {
    const announce: AnnounceMessage = {
      type: ANNOUNCE_TYPE_STICKER_PACK_UPDATED,
      payload: { squad_id: 'squad-1', pack_id: 'pack-1', name: 'Party', entries: [], updated_at: 0, deleted: false },
    };
    render(AnnounceCard, { props: { announce, authorName: 'Eve', timestamp: '' } });
    expect(screen.getByText('Announcement')).toBeTruthy();
    expect(screen.getByText('Eve')).toBeTruthy();
  });
});
