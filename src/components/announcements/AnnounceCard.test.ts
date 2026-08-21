// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import AnnounceCard from './AnnounceCard.svelte';
import {
  ANNOUNCE_TYPE_SAFE_UPDATED,
  ANNOUNCE_TYPE_SAFE_PROPOSAL,
  ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE,
  ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED,
  ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
  ANNOUNCE_TYPE_WAR_GAME_UPDATED,
  ANNOUNCE_TYPE_STICKER_PACK_UPDATED,
  type AnnounceMessage,
} from '../../lib/announcements';

afterEach(() => {
  cleanup();
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
      payload: { parent_id: 'squad-1', evm_address: '0x1111111111111111111111111111111111111111' },
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
