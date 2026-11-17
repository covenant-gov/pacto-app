/**
 * Helpers for pairwise DM wallet-address exchange (request → grant → reciprocal grant).
 */

import { get, writable } from 'svelte/store';
import {
  formatWalletPeerInfoGrant,
  formatWalletPeerInfoRequest,
  parseWalletPeerInfoGrant,
  parseWalletPeerInfoRequest,
  parseWalletTxAnnouncement,
  type WalletPeerInfoGrantPayload,
} from './dm-messages';

export type WalletPeerExchangeMessage = {
  id?: string;
  at?: number;
  mine?: boolean;
  content?: string | null;
};

export type DmPeerEvmWrite = {
  id: string;
  atMs: number;
  address: string;
};

/** Peer npubs with a wallet-info request currently posting (survives WalletBar remount). */
export const walletPeerInfoRequestInFlight = writable<Set<string>>(new Set());
export const walletPeerInfoRequestInFlightRevision = writable(0);

export function resetWalletPeerInfoRequestInFlight(): void {
  walletPeerInfoRequestInFlight.set(new Set());
  walletPeerInfoRequestInFlightRevision.set(0);
}

export function isWalletPeerInfoRequestInFlight(peerNpub: string): boolean {
  const id = peerNpub.trim();
  return id.length > 0 && get(walletPeerInfoRequestInFlight).has(id);
}

export function markWalletPeerInfoRequestInFlight(peerNpub: string): void {
  const id = peerNpub.trim();
  if (!id) return;
  walletPeerInfoRequestInFlight.update((s) => {
    if (s.has(id)) return s;
    const next = new Set(s);
    next.add(id);
    return next;
  });
  walletPeerInfoRequestInFlightRevision.update((n) => n + 1);
}

export function clearWalletPeerInfoRequestInFlight(peerNpub: string): void {
  const id = peerNpub.trim();
  if (!id) return;
  let removed = false;
  walletPeerInfoRequestInFlight.update((s) => {
    if (!s.has(id)) return s;
    removed = true;
    const next = new Set(s);
    next.delete(id);
    return next;
  });
  if (removed) walletPeerInfoRequestInFlightRevision.update((n) => n + 1);
}

export type SendWalletPeerInfoRequestResult =
  | { ok: true }
  | { ok: false; code: 'in_flight' | 'no_address' | 'send_failed' | 'error' };

/** Format + post a wallet peer-info request; in-flight state survives sidebar remount. */
export async function sendWalletPeerInfoRequest(input: {
  peerNpub: string;
  requesterNpub: string;
  post: (json: string) => Promise<boolean>;
  getMyEvmAddress: () => Promise<string>;
}): Promise<SendWalletPeerInfoRequestResult> {
  const peer = input.peerNpub.trim();
  const me = input.requesterNpub.trim();
  if (!peer || !me) return { ok: false, code: 'error' };
  if (isWalletPeerInfoRequestInFlight(peer)) {
    return { ok: false, code: 'in_flight' };
  }
  markWalletPeerInfoRequestInFlight(peer);
  try {
    const myAddr = (await input.getMyEvmAddress())?.trim() || '';
    if (!myAddr) return { ok: false, code: 'no_address' };
    const json = formatWalletPeerInfoRequest({
      request_id: crypto.randomUUID(),
      requester_npub: me,
    });
    const ok = await input.post(json);
    return ok ? { ok: true } : { ok: false, code: 'send_failed' };
  } catch {
    return { ok: false, code: 'error' };
  } finally {
    clearWalletPeerInfoRequestInFlight(peer);
  }
}

/** True if this thread already has an outbound grant for `requestId`. */
export function threadHasOutboundGrantForRequest(
  messages: readonly WalletPeerExchangeMessage[],
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

/**
 * Show an inbound grant card only when we sent the matching request
 * (requester’s single “share accepted” card). Hide outbound grants and declines.
 */
export function shouldShowWalletPeerGrantCard(params: {
  mine: boolean;
  requestId: string;
  myNpub: string | undefined;
  messages: readonly WalletPeerExchangeMessage[];
}): boolean {
  if (params.mine) return false;
  const me = params.myNpub?.trim();
  if (!me) return false;
  return threadHasOutboundRequestForId(params.messages, params.requestId, me);
}

/** True if we sent the original consent request for this id. */
export function threadHasOutboundRequestForId(
  messages: readonly WalletPeerExchangeMessage[],
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
 * Whether an inbound grant's EVM address may be persisted for this peer.
 * Requires we either requested this exchange or already granted (accept + reciprocal).
 */
export function shouldPersistInboundWalletPeerGrant(params: {
  grant: WalletPeerInfoGrantPayload;
  peerNpub: string;
  myNpub: string;
  messages: readonly WalletPeerExchangeMessage[];
}): boolean {
  const { grant, peerNpub, myNpub, messages } = params;
  if (grant.grantor_npub !== peerNpub) return false;
  return (
    threadHasOutboundRequestForId(messages, grant.request_id, myNpub) ||
    threadHasOutboundGrantForRequest(messages, grant.request_id, myNpub)
  );
}

/**
 * Whether receiving this grant should trigger a one-shot reciprocal grant from us.
 */
export function shouldSendReciprocalWalletPeerGrant(params: {
  grant: WalletPeerInfoGrantPayload;
  peerNpub: string;
  myNpub: string;
  messages: readonly WalletPeerExchangeMessage[];
  alreadyReciprocatedRequestIds: readonly string[];
}): boolean {
  const { grant, peerNpub, myNpub, messages, alreadyReciprocatedRequestIds } = params;
  if (grant.grantor_npub !== peerNpub) return false;
  if (alreadyReciprocatedRequestIds.includes(grant.request_id)) return false;
  if (!threadHasOutboundRequestForId(messages, grant.request_id, myNpub)) return false;
  if (threadHasOutboundGrantForRequest(messages, grant.request_id, myNpub)) return false;
  return true;
}

/** Inbound grants that passed persist rules and inbound transfer announcements, oldest first. */
export function dmPeerEvmWritesFromMessages(params: {
  messages: readonly WalletPeerExchangeMessage[];
  peerNpub: string;
  myNpub: string;
}): DmPeerEvmWrite[] {
  const { messages, peerNpub, myNpub } = params;
  const writes: Array<DmPeerEvmWrite & { index: number }> = [];
  messages.forEach((msg, index) => {
    if (msg.mine) return;
    const id = msg.id?.trim();
    if (!id) return;
    const atMs = typeof msg.at === 'number' && Number.isFinite(msg.at) ? msg.at : 0;
    const grant = parseWalletPeerInfoGrant(msg.content ?? '');
    if (
      grant &&
      shouldPersistInboundWalletPeerGrant({ grant, peerNpub, myNpub, messages })
    ) {
      writes.push({ id, atMs, address: grant.evm_address.trim(), index });
      return;
    }
    const ann = parseWalletTxAnnouncement(msg.content ?? '');
    if (ann && ann.from_npub === peerNpub) {
      writes.push({ id, atMs, address: ann.from_evm_address.trim(), index });
    }
  });
  writes.sort((a, b) => a.atMs - b.atMs || a.index - b.index);
  return writes.map(({ id, atMs, address }) => ({ id, atMs, address }));
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
