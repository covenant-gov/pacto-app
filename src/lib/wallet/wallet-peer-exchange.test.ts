import { describe, it, expect } from 'vitest';
import {
  shouldSendReciprocalWalletPeerGrant,
  threadHasOutboundRequestForId,
  threadHasOutboundGrantForRequest,
  formatReciprocalWalletPeerGrant,
} from './wallet-peer-exchange';
import { formatWalletPeerInfoGrant, formatWalletPeerInfoRequest } from './dm-messages';

const NPUB_A = 'npub1aaaaaaaaaaaaaa';
const NPUB_B = 'npub1bbbbbbbbbbbbbb';
const ADDR_A = '0xabcdef0123456789abcdef0123456789abcdef01';
const ADDR_B = '0x1111111111111111111111111111111111111111';

describe('wallet-peer-exchange', () => {
  const requestJson = formatWalletPeerInfoRequest({
    request_id: 'rid-1',
    requester_npub: NPUB_A,
  });
  const grantFromB = formatWalletPeerInfoGrant({
    request_id: 'rid-1',
    grantor_npub: NPUB_B,
    evm_address: ADDR_B,
  });
  const grantFromA = formatWalletPeerInfoGrant({
    request_id: 'rid-1',
    grantor_npub: NPUB_A,
    evm_address: ADDR_A,
  });

  it('detects outbound request and grant in thread', () => {
    const messages = [
      { mine: true, content: requestJson },
      { mine: false, content: grantFromB },
    ];
    expect(threadHasOutboundRequestForId(messages, 'rid-1', NPUB_A)).toBe(true);
    expect(threadHasOutboundGrantForRequest(messages, 'rid-1', NPUB_A)).toBe(false);
    expect(
      threadHasOutboundGrantForRequest(
        [...messages, { mine: true, content: grantFromA }],
        'rid-1',
        NPUB_A
      )
    ).toBe(true);
  });

  it('reciprocates when we requested and peer granted', () => {
    const messages = [
      { mine: true, content: requestJson },
      { mine: false, content: grantFromB },
    ];
    expect(
      shouldSendReciprocalWalletPeerGrant({
        grant: {
          type: 'wallet_peer_info_grant',
          version: 1,
          request_id: 'rid-1',
          grantor_npub: NPUB_B,
          evm_address: ADDR_B,
        },
        peerNpub: NPUB_B,
        myNpub: NPUB_A,
        messages,
        alreadyReciprocatedRequestIds: [],
      })
    ).toBe(true);
  });

  it('does not reciprocate when we did not send the request', () => {
    const messages = [{ mine: false, content: grantFromB }];
    expect(
      shouldSendReciprocalWalletPeerGrant({
        grant: {
          type: 'wallet_peer_info_grant',
          version: 1,
          request_id: 'rid-1',
          grantor_npub: NPUB_B,
          evm_address: ADDR_B,
        },
        peerNpub: NPUB_B,
        myNpub: NPUB_A,
        messages,
        alreadyReciprocatedRequestIds: [],
      })
    ).toBe(false);
  });

  it('does not reciprocate twice', () => {
    const messages = [
      { mine: true, content: requestJson },
      { mine: false, content: grantFromB },
      { mine: true, content: grantFromA },
    ];
    expect(
      shouldSendReciprocalWalletPeerGrant({
        grant: {
          type: 'wallet_peer_info_grant',
          version: 1,
          request_id: 'rid-1',
          grantor_npub: NPUB_B,
          evm_address: ADDR_B,
        },
        peerNpub: NPUB_B,
        myNpub: NPUB_A,
        messages,
        alreadyReciprocatedRequestIds: [],
      })
    ).toBe(false);
    expect(
      shouldSendReciprocalWalletPeerGrant({
        grant: {
          type: 'wallet_peer_info_grant',
          version: 1,
          request_id: 'rid-1',
          grantor_npub: NPUB_B,
          evm_address: ADDR_B,
        },
        peerNpub: NPUB_B,
        myNpub: NPUB_A,
        messages: [
          { mine: true, content: requestJson },
          { mine: false, content: grantFromB },
        ],
        alreadyReciprocatedRequestIds: ['rid-1'],
      })
    ).toBe(false);
  });

  it('formats reciprocal grant json', () => {
    const j = formatReciprocalWalletPeerGrant({
      requestId: 'rid-1',
      myNpub: NPUB_A,
      myEvmAddress: ADDR_A,
    });
    expect(j).toContain('wallet_peer_info_grant');
    expect(j).toContain(ADDR_A);
    expect(j).toContain('rid-1');
  });
});
