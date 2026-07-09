import { describe, it, expect } from 'vitest';
import {
  resolveDmMessagePresentation,
  isInvitePresentation,
  inviteInviterNpub,
  getInviterDisplayFromNpub,
  getInviterDisplay,
  buildPlainMessageProps,
} from './resolve-dm-message-presentation';
import type { DmMessage } from '../../stores/dm';
import type { PactoAppInboxEntry } from '../pacto-app-inbox';
import type { NostrProfile } from '../api/nostr';

const NPUB_A = 'npub1alice0000000';
const NPUB_B = 'npub1bob00000000';
const EVM_A = '0x1111111111111111111111111111111111111111';
const TX_HASH = `0x${'a'.repeat(64)}`;

const SAMPLE_REQUEST = `{"version":1,"type":"wallet_tx_request","request_id":"550e8400-e29b-41d4-a716-446655440000","network":"sepolia","asset":"ETH","amount":"0.05","from_evm_address":"${EVM_A}","created_at_ms":1710000000000}`;

const CHANNEL_IN_SQUAD = JSON.stringify({
  type: 'channel_in_squad',
  squadName: 'Alpha',
  announcementsGroupId: 'ag1',
  channelGroupId: 'cg1',
  channelName: 'general',
});

const SQUAD_INVITE = JSON.stringify({
  type: 'squad_invite',
  squadName: 'Alpha',
  groupId: 'g1',
  kind: 'squad',
  invitedByNpub: NPUB_A,
});

const SQUAD_PAIR_INVITE = JSON.stringify({
  type: 'squad_invite',
  squadName: 'Pair',
  groupId: 'g2',
  kind: 'squad-pair',
  pairedSquads: [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ],
});

const PEER_INFO_REQUEST = JSON.stringify({
  version: 1,
  type: 'wallet_peer_info_request',
  request_id: 'r1',
  requester_npub: NPUB_A,
  requester_evm_address: EVM_A,
});

const PEER_INFO_GRANT = JSON.stringify({
  version: 1,
  type: 'wallet_peer_info_grant',
  request_id: 'r1',
  grantor_npub: NPUB_A,
  evm_address: EVM_A,
});

const PEER_INFO_DECLINE = JSON.stringify({
  version: 1,
  type: 'wallet_peer_info_decline',
  request_id: 'r1',
});

const WALLET_TX_ANNOUNCEMENT = JSON.stringify({
  version: 1,
  type: 'wallet_tx_announcement',
  network: 'sepolia',
  asset: 'ETH',
  amount: '0.05',
  tx_hash: TX_HASH,
  from_npub: NPUB_A,
  to_npub: NPUB_B,
  from_evm_address: EVM_A,
});

function msg(overrides: Partial<PactoAppInboxEntry> = {}): DmMessage {
  return {
    id: 'm1',
    content: 'hello',
    at: 1,
    mine: false,
    ...overrides,
  };
}

function profile(overrides: Partial<NostrProfile> = {}): NostrProfile {
  return {
    id: NPUB_A,
    name: 'Alice',
    display_name: 'Alice Display',
    nickname: 'Ally',
    avatar: 'https://example.com/a.png',
    ...overrides,
  } as NostrProfile;
}

describe('resolveDmMessagePresentation', () => {
  it('returns local-announcement for thread announcements', () => {
    expect(resolveDmMessagePresentation(msg({ is_local_announcement: true, content: 'Blocked' }))).toEqual({
      kind: 'local-announcement',
    });
  });

  it('returns plain for normal text', () => {
    expect(resolveDmMessagePresentation(msg({ content: 'hello' }))).toEqual({ kind: 'plain' });
  });

  it('classifies channel-in-squad JSON', () => {
    const p = resolveDmMessagePresentation(msg({ content: CHANNEL_IN_SQUAD }));
    expect(p.kind).toBe('channel-in-squad');
    if (p.kind === 'channel-in-squad') {
      expect(p.payload.channelGroupId).toBe('cg1');
      expect(p.payload.channelName).toBe('general');
    }
  });

  it('classifies squad invite JSON', () => {
    const p = resolveDmMessagePresentation(msg({ content: SQUAD_INVITE }));
    expect(p.kind).toBe('squad-invite');
    if (p.kind === 'squad-invite') {
      expect(p.payload.groupId).toBe('g1');
      expect(p.payload.squadName).toBe('Alpha');
    }
  });

  it('classifies squad-pair invite JSON', () => {
    const p = resolveDmMessagePresentation(msg({ content: SQUAD_PAIR_INVITE }));
    expect(p.kind).toBe('squad-pair-invite');
    if (p.kind === 'squad-pair-invite') {
      expect(p.payload.groupId).toBe('g2');
      expect(p.payload.kind).toBe('squad-pair');
    }
  });

  it('classifies wallet peer info request JSON', () => {
    const p = resolveDmMessagePresentation(msg({ content: PEER_INFO_REQUEST }));
    expect(p.kind).toBe('wallet-peer-info-request');
    if (p.kind === 'wallet-peer-info-request') {
      expect(p.payload.request_id).toBe('r1');
    }
  });

  it('classifies wallet peer info grant JSON', () => {
    const p = resolveDmMessagePresentation(msg({ content: PEER_INFO_GRANT }));
    expect(p.kind).toBe('wallet-peer-info-grant');
    if (p.kind === 'wallet-peer-info-grant') {
      expect(p.payload.evm_address).toBe(EVM_A);
    }
  });

  it('classifies wallet peer info decline JSON', () => {
    const p = resolveDmMessagePresentation(msg({ content: PEER_INFO_DECLINE }));
    expect(p.kind).toBe('wallet-peer-info-decline');
  });

  it('classifies wallet tx request JSON', () => {
    const p = resolveDmMessagePresentation(msg({ content: SAMPLE_REQUEST }));
    expect(p.kind).toBe('wallet-tx-request');
    if (p.kind === 'wallet-tx-request') {
      expect(p.payload.request_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    }
  });

  it('classifies wallet tx announcement JSON', () => {
    const p = resolveDmMessagePresentation(msg({ content: WALLET_TX_ANNOUNCEMENT }));
    expect(p.kind).toBe('wallet-tx-announcement');
    if (p.kind === 'wallet-tx-announcement') {
      expect(p.payload.tx_hash).toBe(TX_HASH);
    }
  });

  it('falls back to plain for invalid or non-JSON content', () => {
    expect(resolveDmMessagePresentation(msg({ content: 'not json' }))).toEqual({ kind: 'plain' });
    expect(resolveDmMessagePresentation(msg({ content: '' }))).toEqual({ kind: 'plain' });
    expect(resolveDmMessagePresentation(msg({ content: '{"type":"unknown"}' }))).toEqual({ kind: 'plain' });
  });
});

describe('isInvitePresentation', () => {
  it('covers invite kinds only', () => {
    expect(isInvitePresentation({ kind: 'channel-in-squad', payload: {} as never })).toBe(true);
    expect(isInvitePresentation({ kind: 'squad-invite', payload: {} as never })).toBe(true);
    expect(isInvitePresentation({ kind: 'squad-pair-invite', payload: {} as never })).toBe(true);
    expect(isInvitePresentation({ kind: 'plain' })).toBe(false);
    expect(isInvitePresentation({ kind: 'wallet-tx-request', payload: {} as never })).toBe(false);
  });
});

describe('inviteInviterNpub', () => {
  it('reads inviterNpub from Pacto App inbox entries', () => {
    const entry = msg({ inviterNpub: `  ${NPUB_A}  ` });
    expect(inviteInviterNpub(entry, '__pacto_app__')).toBe(NPUB_A);
  });

  it('falls back to content inviter for Pacto App entries without inviterNpub', () => {
    const entry = msg({ content: SQUAD_INVITE });
    expect(inviteInviterNpub(entry, '__pacto_app__')).toBe(NPUB_A);
  });

  it('resolves peer npub for non-app threads', () => {
    const message = msg({ npub: NPUB_B, content: 'hi' });
    expect(inviteInviterNpub(message, NPUB_B)).toBe(NPUB_B);
  });

  it('returns null when resolved value is not an npub', () => {
    const message = msg({ npub: 'not-an-npub', content: 'hi' });
    expect(inviteInviterNpub(message, 'not-an-npub')).toBeNull();
  });
});

describe('getInviterDisplayFromNpub', () => {
  it('returns Someone when npub is missing', () => {
    expect(getInviterDisplayFromNpub(null, {})).toEqual({
      inviterName: 'Someone',
      inviterAvatarSrc: null,
    });
    expect(getInviterDisplayFromNpub(undefined, {})).toEqual({
      inviterName: 'Someone',
      inviterAvatarSrc: null,
    });
  });

  it('uses profile display name and avatar when available', () => {
    const profiles = { [NPUB_A]: profile() };
    const result = getInviterDisplayFromNpub(NPUB_A, profiles);
    expect(result.inviterName).toBe('Ally');
    expect(result.inviterAvatarSrc).toBe('https://example.com/a.png');
  });

  it('falls back to Unknown when profile is absent', () => {
    const result = getInviterDisplayFromNpub(NPUB_A, {});
    expect(result.inviterName).toBe('Unknown');
    expect(result.inviterAvatarSrc).toBeNull();
  });

  it('prefers remote avatar over cached paths', () => {
    const profiles = {
      [NPUB_A]: profile({ avatar: 'https://example.com/remote.png', avatar_cached: '/tmp/local.png' }),
    };
    const result = getInviterDisplayFromNpub(NPUB_A, profiles);
    expect(result.inviterAvatarSrc).toBe('https://example.com/remote.png');
  });
});

describe('getInviterDisplay', () => {
  it('uses activeDmId for messages sent by the current user', () => {
    const message = msg({ mine: true });
    const result = getInviterDisplay(message, NPUB_A, { [NPUB_A]: profile() });
    expect(result.inviterName).toBe('Ally');
  });

  it('uses message npub for inbound messages', () => {
    const message = msg({ mine: false, npub: NPUB_B });
    const result = getInviterDisplay(message, NPUB_A, { [NPUB_B]: profile({ nickname: 'Bob' }) as NostrProfile });
    expect(result.inviterName).toBe('Bob');
  });

  it('falls back to activeDmId when inbound message has no npub', () => {
    const message = msg({ mine: false });
    const result = getInviterDisplay(message, NPUB_A, { [NPUB_A]: profile() });
    expect(result.inviterName).toBe('Ally');
  });
});

describe('buildPlainMessageProps', () => {
  it('builds props for an outbound message', () => {
    const message = msg({ mine: true, content: 'hi' });
    const props = buildPlainMessageProps(message, NPUB_B, { [NPUB_A]: profile() }, NPUB_A);
    expect(props.authorName).toBe('You');
    expect(props.content).toBe('hi');
    expect(props.avatar).toBe('https://example.com/a.png');
    expect(props.timestamp).toBe(new Date(1).toISOString());
  });

  it('builds props for an inbound message using sender profile', () => {
    const message = msg({ mine: false, npub: NPUB_B, content: 'hello' });
    const props = buildPlainMessageProps(
      message,
      NPUB_B,
      { [NPUB_B]: profile({ nickname: 'Bob', avatar: 'https://example.com/b.png' }) as NostrProfile },
      NPUB_A
    );
    expect(props.authorName).toBe('Bob');
    expect(props.avatar).toBe('https://example.com/b.png');
  });

  it('uses the thread npub when inbound message has no sender npub', () => {
    const message = msg({ mine: false, content: 'hello' });
    const props = buildPlainMessageProps(message, NPUB_B, { [NPUB_B]: profile({ nickname: 'Bob' }) as NostrProfile }, NPUB_A);
    expect(props.authorName).toBe('Bob');
  });

  it('renders reply author as You when reply is from current user', () => {
    const message = msg({
      mine: false,
      replied_to: 'r1',
      replied_to_npub: NPUB_A,
      replied_to_content: 'original',
    });
    const props = buildPlainMessageProps(message, NPUB_B, {}, NPUB_A);
    expect(props.replyToId).toBe('r1');
    expect(props.replyAuthorName).toBe('You');
    expect(props.replyPreview).toBe('original');
  });

  it('renders reply author from profile when available', () => {
    const message = msg({
      mine: false,
      replied_to: 'r1',
      replied_to_npub: NPUB_B,
      replied_to_content: 'original',
    });
    const props = buildPlainMessageProps(message, NPUB_B, { [NPUB_B]: profile({ nickname: 'Bob' }) as NostrProfile }, NPUB_A);
    expect(props.replyAuthorName).toBe('Bob');
  });

  it('renders Unknown for anonymous replies', () => {
    const message = msg({ mine: false, replied_to: 'r1' });
    const props = buildPlainMessageProps(message, NPUB_B, {}, NPUB_A);
    expect(props.replyAuthorName).toBe('Unknown');
  });

  it('uses Attachment preview when reply had an attachment', () => {
    const message = msg({
      mine: false,
      replied_to: 'r1',
      replied_to_has_attachment: true,
      replied_to_content: 'text',
    });
    const props = buildPlainMessageProps(message, NPUB_B, {}, NPUB_A);
    expect(props.replyPreview).toBe('Attachment');
  });

  it('truncates long reply content to 80 characters', () => {
    const long = 'a'.repeat(120);
    const message = msg({ mine: false, replied_to: 'r1', replied_to_content: long });
    const props = buildPlainMessageProps(message, NPUB_B, {}, NPUB_A);
    expect(props.replyPreview).toBe(`${long.slice(0, 80)}…`);
  });

  it('renders outbound message with no current user profile', () => {
    const message = msg({ mine: true, content: 'hi' });
    const props = buildPlainMessageProps(message, NPUB_B, {}, undefined);
    expect(props.authorName).toBe('You');
    expect(props.avatar).toBe('');
  });

  it('renders inbound message with no sender or thread npub', () => {
    const message = msg({ mine: false, content: 'hi' });
    const props = buildPlainMessageProps(message, undefined as unknown as string, {}, NPUB_A);
    expect(props.authorName).toBe('Unknown');
    expect(props.avatar).toBe('');
  });

  it('renders reply author as Unknown when reply npub has no profile', () => {
    const message = msg({ mine: false, replied_to: 'r1', replied_to_npub: NPUB_B });
    const props = buildPlainMessageProps(message, NPUB_B, {}, NPUB_A);
    expect(props.replyAuthorName).toBe('Unknown');
  });
});