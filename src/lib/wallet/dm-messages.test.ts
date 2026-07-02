import { describe, it, expect } from 'vitest';
import {
  parseWalletTxRequest,
  parseWalletTxAnnouncement,
  formatWalletTxRequest,
  formatWalletTxAnnouncement,
  getFulfilledWalletRequestIdsFromMessages,
  dedupeWalletTxAnnouncements,
  parseWalletPeerInfoRequest,
  parseWalletPeerInfoGrant,
  parseWalletPeerInfoDecline,
  formatWalletPeerInfoRequest,
  isWalletTxAnnouncementOnChainPending,
} from './dm-messages';

const SAMPLE_FROM_EVM = '0x1111111111111111111111111111111111111111';

const VALID_REQUEST_JSON = `{"version":1,"type":"wallet_tx_request","request_id":"550e8400-e29b-41d4-a716-446655440000","network":"sepolia","asset":"ETH","amount":"0.05","from_evm_address":"${SAMPLE_FROM_EVM}","created_at_ms":1710000000000}`;

const VALID_ANNOUNCE_JSON = `{"version":1,"type":"wallet_tx_announcement","network":"sepolia","asset":"USDC","amount":"10.00","tx_hash":"0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","from_npub":"npub1senderaaaaaaaaaaaaaaaa","to_npub":"npub1recipientbbbbbbbbbbbbbb","from_evm_address":"${SAMPLE_FROM_EVM}","request_id":"550e8400-e29b-41d4-a716-446655440000","block_number":"12345678"}`;

describe('parseWalletTxRequest', () => {
  it('parses compact schema example', () => {
    const p = parseWalletTxRequest(VALID_REQUEST_JSON);
    expect(p).not.toBeNull();
    expect(p!.request_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(p!.network).toBe('sepolia');
    expect(p!.asset).toBe('ETH');
    expect(p!.amount).toBe('0.05');
    expect(p!.from_evm_address).toBe(SAMPLE_FROM_EVM);
    expect(p!.created_at_ms).toBe(1710000000000);
  });

  it('trims whitespace', () => {
    expect(parseWalletTxRequest(`  ${VALID_REQUEST_JSON}  `)?.amount).toBe('0.05');
  });

  it('rejects wrong type', () => {
    expect(
      parseWalletTxRequest(
        '{"version":1,"type":"wallet_tx_announcement","network":"sepolia","asset":"ETH","amount":"1","tx_hash":"0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","from_npub":"npub1aaaaaaaaaaaaaaaaaaaa","to_npub":"npub1bbbbbbbbbbbbbbbbbbbb","from_evm_address":"' +
          SAMPLE_FROM_EVM +
          '"}'
      )
    ).toBeNull();
  });

  it('rejects version !== 1', () => {
    expect(
      parseWalletTxRequest(
        '{"version":2,"type":"wallet_tx_request","request_id":"x","network":"sepolia","asset":"ETH","amount":"1","from_evm_address":"' +
          SAMPLE_FROM_EVM +
          '"}'
      )
    ).toBeNull();
  });

  it('rejects invalid amount', () => {
    expect(
      parseWalletTxRequest(
        '{"version":1,"type":"wallet_tx_request","request_id":"x","network":"sepolia","asset":"ETH","amount":"-1","from_evm_address":"' +
          SAMPLE_FROM_EVM +
          '"}'
      )
    ).toBeNull();
    expect(
      parseWalletTxRequest(
        '{"version":1,"type":"wallet_tx_request","request_id":"x","network":"sepolia","asset":"ETH","amount":1,"from_evm_address":"' +
          SAMPLE_FROM_EVM +
          '"}'
      )
    ).toBeNull();
  });

  it('accepts amount with leading dot (e.g. .00001)', () => {
    const j = `{"version":1,"type":"wallet_tx_request","request_id":"54a38b38-11ee-4214-a38f-b4f48b3f4f23","network":"sepolia","asset":"ETH","amount":".00001","from_evm_address":"${SAMPLE_FROM_EVM}","created_at_ms":1774413697229}`;
    const p = parseWalletTxRequest(j);
    expect(p).not.toBeNull();
    expect(p!.amount).toBe('.00001');
  });

  it('rejects unknown network', () => {
    expect(
      parseWalletTxRequest(
        '{"version":1,"type":"wallet_tx_request","request_id":"x","network":"base","asset":"ETH","amount":"1","from_evm_address":"' +
          SAMPLE_FROM_EVM +
          '"}'
      )
    ).toBeNull();
  });

  it('accepts imported token ticker as asset label', () => {
    const j = `{"version":1,"type":"wallet_tx_request","request_id":"x","network":"sepolia","asset":"DAI","amount":"1.5","from_evm_address":"${SAMPLE_FROM_EVM}"}`;
    const p = parseWalletTxRequest(j);
    expect(p).not.toBeNull();
    expect(p!.asset).toBe('DAI');
  });

  it('round-trips via formatWalletTxRequest', () => {
    const p = parseWalletTxRequest(VALID_REQUEST_JSON)!;
    const again = parseWalletTxRequest(
      formatWalletTxRequest({
        request_id: p.request_id,
        network: p.network,
        asset: p.asset,
        amount: p.amount,
        from_evm_address: p.from_evm_address,
        created_at_ms: p.created_at_ms,
      })
    );
    expect(again).toEqual(p);
  });

  it('rejects missing from_evm_address', () => {
    expect(
      parseWalletTxRequest(
        '{"version":1,"type":"wallet_tx_request","request_id":"x","network":"sepolia","asset":"ETH","amount":"1"}'
      )
    ).toBeNull();
  });

  it('rejects invalid from_evm_address on request', () => {
    expect(
      parseWalletTxRequest(
        '{"version":1,"type":"wallet_tx_request","request_id":"x","network":"sepolia","asset":"ETH","amount":"1","from_evm_address":"not-hex"}'
      )
    ).toBeNull();
  });

  it('formatWalletTxRequest throws without valid from_evm_address', () => {
    expect(() =>
      formatWalletTxRequest({
        request_id: 'x',
        network: 'sepolia',
        asset: 'ETH',
        amount: '1',
        from_evm_address: '0xbad',
      })
    ).toThrow();
  });
});

describe('parseWalletTxAnnouncement', () => {
  it('parses compact schema example', () => {
    const p = parseWalletTxAnnouncement(VALID_ANNOUNCE_JSON);
    expect(p).not.toBeNull();
    expect(p!.tx_hash).toBe('0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789');
    expect(p!.from_evm_address).toBe(SAMPLE_FROM_EVM);
    expect(p!.request_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(p!.block_number).toBe('12345678');
  });

  it('allows optional request_id and block_number omitted', () => {
    const minimal = `{"version":1,"type":"wallet_tx_announcement","network":"mainnet","asset":"ETH","amount":"1","tx_hash":"0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","from_npub":"npub1aaaaaaaaaaaaaaaaaaaa","to_npub":"npub1bbbbbbbbbbbbbbbbbbbb","from_evm_address":"${SAMPLE_FROM_EVM}"}`;
    const p = parseWalletTxAnnouncement(minimal);
    expect(p).not.toBeNull();
    expect(p!.request_id).toBeUndefined();
    expect(p!.block_number).toBeUndefined();
  });

  it('rejects bad tx hash', () => {
    const bad = `{"version":1,"type":"wallet_tx_announcement","network":"sepolia","asset":"ETH","amount":"1","tx_hash":"0xshort","from_npub":"npub1aaaaaaaaaaaaaaaaaaaa","to_npub":"npub1bbbbbbbbbbbbbbbbbbbb","from_evm_address":"${SAMPLE_FROM_EVM}"}`;
    expect(parseWalletTxAnnouncement(bad)).toBeNull();
  });

  it('rejects wrong type', () => {
    expect(parseWalletTxAnnouncement(VALID_REQUEST_JSON)).toBeNull();
  });

  it('round-trips via formatWalletTxAnnouncement', () => {
    const p = parseWalletTxAnnouncement(VALID_ANNOUNCE_JSON)!;
    const again = parseWalletTxAnnouncement(
      formatWalletTxAnnouncement({
        network: p.network,
        asset: p.asset,
        amount: p.amount,
        tx_hash: p.tx_hash,
        from_npub: p.from_npub,
        to_npub: p.to_npub,
        from_evm_address: p.from_evm_address,
        request_id: p.request_id,
        block_number: p.block_number,
      })
    );
    expect(again).toEqual(p);
  });

  it('rejects missing from_evm_address', () => {
    expect(
      parseWalletTxAnnouncement(
        '{"version":1,"type":"wallet_tx_announcement","network":"sepolia","asset":"ETH","amount":"1","tx_hash":"0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","from_npub":"npub1aaaaaaaaaaaaaaaaaaaa","to_npub":"npub1bbbbbbbbbbbbbbbbbbbb"}'
      )
    ).toBeNull();
  });

  it('rejects invalid from_evm_address on announcement', () => {
    const bad =
      '{"version":1,"type":"wallet_tx_announcement","network":"sepolia","asset":"ETH","amount":"1","tx_hash":"0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","from_npub":"npub1aaaaaaaaaaaaaaaaaaaa","to_npub":"npub1bbbbbbbbbbbbbbbbbbbb","from_evm_address":"0xshort"}';
    expect(parseWalletTxAnnouncement(bad)).toBeNull();
  });

  it('formatWalletTxAnnouncement throws without valid from_evm_address', () => {
    expect(() =>
      formatWalletTxAnnouncement({
        network: 'sepolia',
        asset: 'ETH',
        amount: '1',
        tx_hash: '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        from_npub: 'npub1aaaaaaaaaaaaaaaaaaaa',
        to_npub: 'npub1bbbbbbbbbbbbbbbbbbbb',
        from_evm_address: '',
      })
    ).toThrow();
  });
});

const NPUB_A = 'npub1aaaaaaaaaaaaaa';
const NPUB_B = 'npub1bbbbbbbbbbbbbb';
const ADDR_A = '0xabcdef0123456789abcdef0123456789abcdef01';

describe('wallet peer info exchange', () => {
  it('parses and formats wallet_peer_info_request', () => {
    const j = formatWalletPeerInfoRequest({
      request_id: 'rid-1',
      requester_npub: NPUB_A,
      requester_evm_address: ADDR_A,
    });
    const p = parseWalletPeerInfoRequest(j);
    expect(p).not.toBeNull();
    expect(p!.request_id).toBe('rid-1');
    expect(p!.requester_npub).toBe(NPUB_A);
    expect(p!.requester_evm_address).toBe(ADDR_A);
  });

  it('rejects request with invalid address', () => {
    expect(
      parseWalletPeerInfoRequest(
        `{"version":1,"type":"wallet_peer_info_request","request_id":"x","requester_npub":"${NPUB_A}","requester_evm_address":"not-hex"}`
      )
    ).toBeNull();
  });

  it('parses wallet_peer_info_grant', () => {
    const j = `{"version":1,"type":"wallet_peer_info_grant","request_id":"rid-1","grantor_npub":"${NPUB_B}","evm_address":"${ADDR_A}"}`;
    const g = parseWalletPeerInfoGrant(j);
    expect(g).not.toBeNull();
    expect(g!.grantor_npub).toBe(NPUB_B);
    expect(g!.evm_address).toBe(ADDR_A);
  });

  it('parses wallet_peer_info_decline', () => {
    const d = parseWalletPeerInfoDecline(
      '{"version":1,"type":"wallet_peer_info_decline","request_id":"rid-1"}'
    );
    expect(d).not.toBeNull();
    expect(d!.request_id).toBe('rid-1');
  });
});

describe('isWalletTxAnnouncementOnChainPending', () => {
  const ann = parseWalletTxAnnouncement(VALID_ANNOUNCE_JSON)!;
  const pendingAnn = parseWalletTxAnnouncement(
    formatWalletTxAnnouncement({
      network: 'sepolia',
      asset: 'USDC',
      amount: '10.00',
      tx_hash: '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      from_npub: 'npub1senderaaaaaaaaaaaaaaaa',
      to_npub: 'npub1recipientbbbbbbbbbbbbbb',
      from_evm_address: SAMPLE_FROM_EVM,
    }),
  )!;

  it('is false when block_number is present', () => {
    expect(isWalletTxAnnouncementOnChainPending(ann, { id: 'opt-1' })).toBe(false);
  });

  it('is true for optimistic opt- rows without block_number', () => {
    expect(isWalletTxAnnouncementOnChainPending(pendingAnn, { id: 'opt-123' })).toBe(true);
  });

  it('is false when Nostr relay pending but on-chain confirmed metadata exists', () => {
    expect(isWalletTxAnnouncementOnChainPending(ann, { id: 'pending-999', pending: true })).toBe(
      false,
    );
  });

  it('is false for relayed rows without block_number (not opt-)', () => {
    expect(isWalletTxAnnouncementOnChainPending(pendingAnn, { id: 'pending-999' })).toBe(false);
  });
});

describe('getFulfilledWalletRequestIdsFromMessages', () => {
  const annWithReq = `{"version":1,"type":"wallet_tx_announcement","network":"sepolia","asset":"ETH","amount":"1","tx_hash":"0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","from_npub":"npub1aaaaaaaaaaaaaaaaaaaa","to_npub":"npub1bbbbbbbbbbbbbbbbbbbb","from_evm_address":"${SAMPLE_FROM_EVM}","request_id":"req-uuid-1"}`;
  const annNoReq = `{"version":1,"type":"wallet_tx_announcement","network":"sepolia","asset":"ETH","amount":"1","tx_hash":"0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","from_npub":"npub1aaaaaaaaaaaaaaaaaaaa","to_npub":"npub1bbbbbbbbbbbbbbbbbbbb","from_evm_address":"${SAMPLE_FROM_EVM}"}`;

  it('returns request_ids from announcements only', () => {
    const set = getFulfilledWalletRequestIdsFromMessages([
      { content: 'hello' },
      { content: annWithReq },
      { content: annNoReq },
    ]);
    expect(set.has('req-uuid-1')).toBe(true);
    expect(set.size).toBe(1);
  });
});

describe('dedupeWalletTxAnnouncements', () => {
  const TX = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  const pending = `{"version":1,"type":"wallet_tx_announcement","network":"sepolia","asset":"ETH","amount":"0.000001","tx_hash":"${TX}","from_npub":"npub1aaaaaaaaaaaaaaaaaaaa","to_npub":"npub1bbbbbbbbbbbbbbbbbbbb","from_evm_address":"${SAMPLE_FROM_EVM}"}`;
  const confirmed = `${pending.slice(0, -1)},"block_number":"12345678"}`;

  it('keeps one announcement per tx_hash, preferring confirmed relayed rows', () => {
    const out = dedupeWalletTxAnnouncements([
      { id: 'opt-1', content: pending, pending: true, at: 1 },
      { id: 'nostr-abc', content: confirmed, at: 2 },
      { id: 'nostr-dup', content: confirmed, at: 3 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('nostr-dup');
  });
});
