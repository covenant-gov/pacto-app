import { describe, expect, it } from 'vitest';
import {
  ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
  ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED,
  ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
  ANNOUNCE_TYPE_WAR_GAME_UPDATED,
  ANNOUNCE_TYPE_SAFE_PROPOSAL,
  ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE,
  ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED,
  ANNOUNCE_TYPE_SQUAD_EVENT_CREATED,
  ANNOUNCE_TYPE_SQUAD_EVENT_SERIES_CREATED,
  ANNOUNCE_TYPE_SQUAD_DOC_ADDED,
  buildAnnounceContent,
  parseAnnouncement,
  squadEventCardView,
  squadEventSeriesOverlay,
  type SquadEventCreatedPayload,
} from './announcements';
import type { SquadEventDto } from './api/squad-events';

function eventRow(overrides: Partial<SquadEventDto> = {}): SquadEventDto {
  return {
    id: 'evt-1',
    parentId: 'squad-1',
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
    channelId: null,
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

describe('squad event announcements', () => {
  const timedPayload: SquadEventCreatedPayload = {
    id: 'evt-1',
    parent_id: 'squad-1',
    series_id: null,
    kind: 31923,
    title: 'Standup',
    start: 1_767_225_600,
    end: null,
    start_tzid: 'America/New_York',
    channel_id: 'grp-ann',
  };

  it('parses a single-event card and drops any place fields', () => {
    const parsed = parseAnnouncement(
      JSON.stringify({
        type: ANNOUNCE_TYPE_SQUAD_EVENT_CREATED,
        payload: { ...timedPayload, location: '123 Secret Street', place: 'offline' },
      }),
    );
    expect(parsed).toEqual({ type: ANNOUNCE_TYPE_SQUAD_EVENT_CREATED, payload: timedPayload });
    expect(JSON.stringify(parsed)).not.toContain('Secret');
  });

  it('parses an all-day card with civil dates', () => {
    const parsed = parseAnnouncement(
      JSON.stringify({
        type: ANNOUNCE_TYPE_SQUAD_EVENT_CREATED,
        payload: { ...timedPayload, kind: 31922, start: '2026-03-08', end: '2026-03-09' },
      }),
    );
    expect(parsed?.payload).toMatchObject({ kind: 31922, start: '2026-03-08', end: '2026-03-09' });
  });

  it('rejects a start that does not match the kind', () => {
    expect(
      parseAnnouncement(
        JSON.stringify({ type: ANNOUNCE_TYPE_SQUAD_EVENT_CREATED, payload: { ...timedPayload, start: '2026-03-08' } }),
      ),
    ).toBeNull();
    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_SQUAD_EVENT_CREATED,
          payload: { ...timedPayload, kind: 31922, start: 1_767_225_600 },
        }),
      ),
    ).toBeNull();
  });

  it('parses a series card', () => {
    const payload = {
      series_id: 'series-1',
      parent_id: 'squad-1',
      kind: 31923,
      title: 'Weekly sync',
      first_start: 1_767_225_600,
      start_tzid: 'America/New_York',
      count: 8,
      channel_id: null,
    };
    expect(
      parseAnnouncement(JSON.stringify({ type: ANNOUNCE_TYPE_SQUAD_EVENT_SERIES_CREATED, payload })),
    ).toEqual({ type: ANNOUNCE_TYPE_SQUAD_EVENT_SERIES_CREATED, payload });
    expect(
      parseAnnouncement(
        JSON.stringify({ type: ANNOUNCE_TYPE_SQUAD_EVENT_SERIES_CREATED, payload: { ...payload, count: 0 } }),
      ),
    ).toBeNull();
  });

  it('routes event cards to the announcements bucket', () => {
    const o = JSON.parse(buildAnnounceContent({ type: ANNOUNCE_TYPE_SQUAD_EVENT_CREATED, payload: timedPayload })) as {
      pacto_virtual_bucket?: string;
    };
    expect(o.pacto_virtual_bucket).toBe('announcements');
  });

  it('card view uses the stored payload when the replica is not loaded', () => {
    expect(squadEventCardView(timedPayload, null)).toEqual({
      title: 'Standup',
      start: { startUnix: 1_767_225_600, startDate: null, startTzid: 'America/New_York' },
      cancelled: false,
      unavailable: false,
    });
  });

  it('card view is unavailable when the loaded replica has no row for the event', () => {
    expect(squadEventCardView(timedPayload, [eventRow({ id: 'other' })])).toMatchObject({
      title: 'Standup',
      cancelled: false,
      unavailable: true,
    });
  });

  it('card view overlays the latest title, start, and cancelled status from the replica', () => {
    const view = squadEventCardView(timedPayload, [
      eventRow({ title: 'Standup (moved)', startUnix: 1_767_229_200, status: 'cancelled' }),
    ]);
    expect(view).toEqual({
      title: 'Standup (moved)',
      start: { startUnix: 1_767_229_200, startDate: null, startTzid: 'America/New_York' },
      cancelled: true,
      unavailable: false,
    });
  });

  it('series overlay counts active occurrences, reports zero rows after a load, and null before', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      eventRow({ id: `evt-${i}`, seriesId: 'series-1', status: i === 2 ? 'cancelled' : 'active' }),
    );
    expect(squadEventSeriesOverlay('series-1', rows)).toEqual({ total: 8, active: 7 });
    expect(squadEventSeriesOverlay('series-2', rows)).toEqual({ total: 0, active: 0 });
    expect(squadEventSeriesOverlay('series-1', null)).toBeNull();
  });
});

describe('squad doc announcements', () => {
  function docAdded(payload: Record<string, unknown> = {}): string {
    return JSON.stringify({
      type: ANNOUNCE_TYPE_SQUAD_DOC_ADDED,
      payload: {
        id: 'doc-1',
        parent_id: 'squad-1',
        title: 'Agenda',
        provider: 'cryptpad',
        channel_id: 'grp-ops',
        display_url: 'https://cryptpad.fr/pad/#••••',
        ...payload,
      },
    });
  }

  it('parses a doc-added card with the masked URL', () => {
    expect(parseAnnouncement(docAdded())).toEqual({
      type: ANNOUNCE_TYPE_SQUAD_DOC_ADDED,
      payload: {
        id: 'doc-1',
        parent_id: 'squad-1',
        title: 'Agenda',
        provider: 'cryptpad',
        channel_id: 'grp-ops',
        display_url: 'https://cryptpad.fr/pad/#••••',
      },
    });
  });

  it('drops a stray raw url and note and re-masks a leaked fragment or secret query value', () => {
    const parsed = parseAnnouncement(
      docAdded({
        url: 'https://cryptpad.fr/pad/#/2/pad/edit/secret',
        note: 'private note',
        display_url: 'https://cryptpad.fr/pad/?token=abc#/2/pad/edit/secret',
      })
    );
    const text = JSON.stringify(parsed);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('abc');
    expect(text).not.toContain('private note');
    expect(parsed?.payload).toMatchObject({ display_url: 'https://cryptpad.fr/pad/?token=••••#••••' });
  });

  it('falls back to other for an unknown provider and accepts an untagged doc', () => {
    expect(parseAnnouncement(docAdded({ provider: 'dropbox', channel_id: null }))?.payload).toMatchObject({
      provider: 'other',
      channel_id: null,
    });
  });

  it('rejects a card without a title or display url', () => {
    expect(parseAnnouncement(docAdded({ title: '' }))).toBeNull();
    expect(parseAnnouncement(docAdded({ display_url: null }))).toBeNull();
  });
});

describe('buildAnnounceContent', () => {
  it('sets pacto_virtual_bucket inbox for governance-safe automation', () => {
    const s = buildAnnounceContent({
      type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
      payload: { parent_id: 'p', provider: 'gnosis_safe', canonical_ref: '0x1' },
    });
    const o = JSON.parse(s) as { pacto_virtual_bucket?: string };
    expect(o.pacto_virtual_bucket).toBe('inbox');
  });

  it('sets pacto_virtual_bucket announcements for squad sponsor deploy', () => {
    const s = buildAnnounceContent({
      type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
      payload: { parent_id: 'p', provider: 'sponsor', canonical_ref: '0x1' },
    });
    expect(JSON.parse(s).pacto_virtual_bucket).toBe('announcements');
  });

  it('sets pacto_virtual_bucket announcements for pacto_gov deploy', () => {
    const s = buildAnnounceContent({
      type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
      payload: { parent_id: 'p', provider: 'pacto_gov', canonical_ref: '3519' },
    });
    expect(JSON.parse(s).pacto_virtual_bucket).toBe('announcements');
  });

  it('sets pacto_virtual_bucket announcements for dashboard_poll_created', () => {
    const s = buildAnnounceContent({
      type: ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
      payload: {
        parent_id: 'p',
        poll_id: 'poll',
        title: 'T',
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      },
    });
    expect(JSON.parse(s).pacto_virtual_bucket).toBe('announcements');
  });

  it('sets pacto_virtual_bucket announcements for governance_process_updated', () => {
    const s = buildAnnounceContent({
      type: ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED,
      payload: { parent_id: 'p', kind: 'ta_proposal', proposal_id: '1' },
    });
    expect(JSON.parse(s).pacto_virtual_bucket).toBe('announcements');
  });

  it('sets pacto_virtual_bucket announcements for war_game_updated', () => {
    const s = buildAnnounceContent({
      type: ANNOUNCE_TYPE_WAR_GAME_UPDATED,
      payload: {
        parent_id: 'p',
        action: 'deploy',
        canonical_ref: '1',
        chain: 'sepolia',
        entry_id: 'pacto-gov-wargame-p',
        round: '1',
        game_squad_id: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        sponsor: '0x5555555555555555555555555555555555555555',
        provider_payload: '{"status":"active","round":"1","gameSquadId":"0xaa","sponsor":"0x55"}',
      },
    });
    expect(JSON.parse(s).pacto_virtual_bucket).toBe('announcements');
  });

  it('preserves type and payload', () => {
    const payload = { squad_id: 's', safe_address: '0xabc' };
    const s = buildAnnounceContent({ type: ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED, payload });
    expect(JSON.parse(s)).toMatchObject({ type: ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED, payload });
  });

  it('honors explicit virtualBucket override', () => {
    const s = buildAnnounceContent(
      {
        type: ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED,
        payload: { squad_id: 's', safe_address: '0xabc' },
      },
      { virtualBucket: 'polls' },
    );
    expect(JSON.parse(s).pacto_virtual_bucket).toBe('polls');
  });
});

describe('parseAnnouncement', () => {
  it('rejects non-announcement envelopes', () => {
    expect(parseAnnouncement('')).toBeNull();
    expect(parseAnnouncement('plain')).toBeNull();
    expect(parseAnnouncement('{')).toBeNull();
    expect(parseAnnouncement(JSON.stringify({ type: 'x' }))).toBeNull();
    expect(parseAnnouncement(JSON.stringify({ type: 'x', payload: {} }))).toBeNull();
  });

  it('parses known announce types', () => {
    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED,
          payload: { squad_id: 's', safe_address: '0x1' },
        }),
      ),
    ).toMatchObject({ type: ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED });

    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_SAFE_PROPOSAL,
          payload: {
            id: '1',
            parent_id: 'p',
            to: '0x2',
            amount: '1',
            token: 'ETH',
            proposer_npub: 'npub1',
          },
        }),
      ),
    ).toMatchObject({ type: ANNOUNCE_TYPE_SAFE_PROPOSAL });

    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE,
          payload: {
            parent_id: 'p',
            member_npub: 'npub1alice',
            evm_address: '0xabc',
            issued_at: 1710000000,
            signature: '0x' + 'ab'.repeat(65),
          },
        }),
      ),
    ).toMatchObject({ type: ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE });

    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE,
          payload: { parent_id: 'p', evm_address: '0xabc' },
        }),
      ),
    ).toBeNull();

    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
          payload: { parent_id: 'p', provider: 'pacto_gov', canonical_ref: '1' },
        }),
      ),
    ).toMatchObject({ type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED });

    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_WAR_GAME_UPDATED,
          payload: {
            parent_id: 'p',
            action: 'deploy',
            canonical_ref: '1',
            chain: 'sepolia',
            entry_id: 'pacto-gov-wargame-p',
            round: '1',
            game_squad_id: '0xaa',
            sponsor: '0x55',
            provider_payload: '{"status":"active"}',
          },
        }),
      ),
    ).toMatchObject({ type: ANNOUNCE_TYPE_WAR_GAME_UPDATED });

    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED,
          payload: { parent_id: 'p', kind: 'qm_pending', address: '0x1', tx_hash: '0xabc' },
        }),
      ),
    ).toMatchObject({ type: ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED });

    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED,
          payload: { parent_id: 'p', kind: 'hats', tx_hash: '0xabc' },
        }),
      ),
    ).toMatchObject({ type: ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED, payload: { kind: 'hats' } });

    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED,
          payload: {
            parent_id: 'p',
            kind: 'hats',
            stack: 'pacto_gov',
            block_number: '42',
            snapshot: { memberHatByAddress: { '0xaa': 'Captain' } },
          },
        }),
      ),
    ).toMatchObject({
      type: ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED,
      payload: { stack: 'pacto_gov', block_number: '42' },
    });

    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
          payload: {
            parent_id: 'p',
            poll_id: 'poll',
            title: 'Title',
            options: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B' },
            ],
          },
        }),
      ),
    ).toMatchObject({ type: ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED });
  });

  it('rejects invalid payloads for known types', () => {
    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE,
          payload: { parent_id: '  ', evm_address: '0xabc' },
        }),
      ),
    ).toBeNull();

    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
          payload: { parent_id: 'p', poll_id: 'id', title: 'T', options: [{ id: 'a', label: 'A' }] },
        }),
      ),
    ).toBeNull();

    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
          payload: {
            parent_id: 'p',
            poll_id: 'id',
            title: 'T',
            options: [
              { id: 'a', label: 'A' },
              { id: ' ', label: 'B' },
            ],
          },
        }),
      ),
    ).toBeNull();

    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
          payload: { parent_id: 'p', provider: '', canonical_ref: '1' },
        }),
      ),
    ).toBeNull();

    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED,
          payload: { squad_id: 1, safe_address: '0x1' },
        }),
      ),
    ).toBeNull();

    expect(
      parseAnnouncement(
        JSON.stringify({
          type: ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED,
          payload: { parent_id: 'p', kind: 'unknown' },
        }),
      ),
    ).toBeNull();
  });
});
