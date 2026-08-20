import { describe, expect, it } from 'vitest';
import {
  ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
  ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED,
  ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
  ANNOUNCE_TYPE_WAR_GAME_UPDATED,
  ANNOUNCE_TYPE_SAFE_PROPOSAL,
  ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE,
  ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED,
  buildAnnounceContent,
  parseAnnouncement,
} from './announcements';

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
          payload: { parent_id: 'p', evm_address: '0xabc' },
        }),
      ),
    ).toMatchObject({ type: ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE });

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
  });
});
