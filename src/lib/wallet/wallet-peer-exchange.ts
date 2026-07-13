/**
 * Helpers for pairwise DM wallet-address exchange (request → grant → reciprocal grant).
 */

import {
  formatWalletPeerInfoGrant,
  parseWalletPeerInfoGrant,
  parseWalletPeerInfoRequest,
  type WalletPeerInfoGrantPayload,
} from './dm-messages';

export type WalletPeerExchangeMessage = {
  mine?: boolean;
  content?: string | null;
};

/** True if this thread already has an outbound grant for `requestId`. */
export function threadHasOutboundGrantForRequest(
  messages: WalletPeerExchangeMessage[],
  requestId: string,
  myNpub: string
): boolean {
  for (const msg of messages) {
    if (!msg.mine) continue;
    const g = parseWalletPeerInfoGrant(msg.content ?? '');
    if (!g) continue;
    if (g.request_id === requestId && g.grantor_npub === myNpub) return true;
  }
  return false;
}

/** True if we sent the original consent request for this id. */
export function threadHasOutboundRequestForId(
  messages: WalletPeerExchangeMessage[],
  requestId: string,
  myNpub: string
): boolean {
  for (const msg of messages) {
    if (!msg.mine) continue;
    const r = parseWalletPeerInfoRequest(msg.content ?? '');
    if (!r) continue;
    if (r.request_id === requestId && r.requester_npub === myNpub) return true;
  }
  return false;
}

/**
 * Whether receiving this grant should trigger a one-shot reciprocal grant from us.
 */
export function shouldSendReciprocalWalletPeerGrant(params: {
  grant: WalletPeerInfoGrantPayload;
  peerNpub: string;
  myNpub: string;
  messages: WalletPeerExchangeMessage[];
  alreadyReciprocatedRequestIds: readonly string[];
}): boolean {
  const { grant, peerNpub, myNpub, messages, alreadyReciprocatedRequestIds } = params;
  if (grant.grantor_npub !== peerNpub) return false;
  if (alreadyReciprocatedRequestIds.includes(grant.request_id)) return false;
  if (!threadHasOutboundRequestForId(messages, grant.request_id, myNpub)) return false;
  if (threadHasOutboundGrantForRequest(messages, grant.request_id, myNpub)) return false;
  return true;
}

export function formatReciprocalWalletPeerGrant(params: {
  requestId: string;
  myNpub: string;
  myEvmAddress: string;
}): string {
  return formatWalletPeerInfoGrant({
    request_id: params.requestId,
    grantor_npub: params.myNpub,
    evm_address: params.myEvmAddress,
  });
}
