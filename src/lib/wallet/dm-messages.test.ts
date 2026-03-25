import { describe, it, expect } from 'vitest';
import {
  parseWalletTxRequest,
  parseWalletTxAnnouncement,
  formatWalletTxRequest,
  formatWalletTxAnnouncement,
  getFulfilledWalletRequestIdsFromMessages,
} from './dm-messages';

const VALID_REQUEST_JSON =
  '{"version":1,"type":"wallet_tx_request","request_id":"550e8400-e29b-41d4-a716-446655440000","network":"sepolia","asset":"ETH","amount":"0.05","created_at_ms":1710000000000}';

const VALID_ANNOUNCE_JSON =
  '{"version":1,"type":"wallet_tx_announcement","network":"sepolia","asset":"USDC","amount":"10.00","tx_hash":"0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","from_npub":"npub1senderaaaaaaaaaaaaaaaa","to_npub":"npub1recipientbbbbbbbbbbbbbb","request_id":"550e8400-e29b-41d4-a716-446655440000","block_number":"12345678"}';

describe('parseWalletTxRequest', () => {
  it('parses compact schema example', () => {
    const p = parseWalletTxRequest(VALID_REQUEST_JSON);
    expect(p).not.toBeNull();
    expect(p!.request_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(p!.network).toBe('sepolia');
    expect(p!.asset).toBe('ETH');
    expect(p!.amount).toBe('0.05');
    expect(p!.created_at_ms).toBe(1710000000000);
  });

  it('trims whitespace', () => {
    expect(parseWalletTxRequest(`  ${VALID_REQUEST_JSON}  `)?.amount).toBe('0.05');
  });

  it('rejects wrong type', () => {
    expect(parseWalletTxRequest('{"version":1,"type":"wallet_tx_announcement","network":"sepolia","asset":"ETH","amount":"1","tx_hash":"0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","from_npub":"npub1aaaaaaaaaaaaaaaaaaaa","to_npub":"npub1bbbbbbbbbbbbbbbbbbbb"}')).toBeNull();
  });

  it('rejects version !== 1', () => {
    expect(
      parseWalletTxRequest(
        '{"version":2,"type":"wallet_tx_request","request_id":"x","network":"sepolia","asset":"ETH","amount":"1"}'
      )
    ).toBeNull();
  });

  it('rejects invalid amount', () => {
    expect(
      parseWalletTxRequest(
        '{"version":1,"type":"wallet_tx_request","request_id":"x","network":"sepolia","asset":"ETH","amount":"-1"}'
      )
    ).toBeNull();
    expect(
      parseWalletTxRequest(
        '{"version":1,"type":"wallet_tx_request","request_id":"x","network":"sepolia","asset":"ETH","amount":1}'
      )
    ).toBeNull();
  });

  it('rejects unknown network', () => {
    expect(
      parseWalletTxRequest(
        '{"version":1,"type":"wallet_tx_request","request_id":"x","network":"base","asset":"ETH","amount":"1"}'
      )
    ).toBeNull();
  });

  it('accepts imported token ticker as asset label', () => {
    const j =
      '{"version":1,"type":"wallet_tx_request","request_id":"x","network":"sepolia","asset":"DAI","amount":"1.5"}';
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
        created_at_ms: p.created_at_ms,
      })
    );
    expect(again).toEqual(p);
  });
});

describe('parseWalletTxAnnouncement', () => {
  it('parses compact schema example', () => {
    const p = parseWalletTxAnnouncement(VALID_ANNOUNCE_JSON);
    expect(p).not.toBeNull();
    expect(p!.tx_hash).toBe('0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789');
    expect(p!.request_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(p!.block_number).toBe('12345678');
  });

  it('allows optional request_id and block_number omitted', () => {
    const minimal =
      '{"version":1,"type":"wallet_tx_announcement","network":"mainnet","asset":"ETH","amount":"1","tx_hash":"0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","from_npub":"npub1aaaaaaaaaaaaaaaaaaaa","to_npub":"npub1bbbbbbbbbbbbbbbbbbbb"}';
    const p = parseWalletTxAnnouncement(minimal);
    expect(p).not.toBeNull();
    expect(p!.request_id).toBeUndefined();
    expect(p!.block_number).toBeUndefined();
  });

  it('rejects bad tx hash', () => {
    const bad =
      '{"version":1,"type":"wallet_tx_announcement","network":"sepolia","asset":"ETH","amount":"1","tx_hash":"0xshort","from_npub":"npub1aaaaaaaaaaaaaaaaaaaa","to_npub":"npub1bbbbbbbbbbbbbbbbbbbb"}';
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
        request_id: p.request_id,
        block_number: p.block_number,
      })
    );
    expect(again).toEqual(p);
  });
});

describe('getFulfilledWalletRequestIdsFromMessages', () => {
  const annWithReq =
    '{"version":1,"type":"wallet_tx_announcement","network":"sepolia","asset":"ETH","amount":"1","tx_hash":"0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","from_npub":"npub1aaaaaaaaaaaaaaaaaaaa","to_npub":"npub1bbbbbbbbbbbbbbbbbbbb","request_id":"req-uuid-1"}';
  const annNoReq =
    '{"version":1,"type":"wallet_tx_announcement","network":"sepolia","asset":"ETH","amount":"1","tx_hash":"0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","from_npub":"npub1aaaaaaaaaaaaaaaaaaaa","to_npub":"npub1bbbbbbbbbbbbbbbbbbbb"}';

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
