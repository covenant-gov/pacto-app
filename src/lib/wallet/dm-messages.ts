/**
 * DM wallet message payloads: `wallet_tx_request` and `wallet_tx_announcement`.
 * Schema: docs/wallet/DM_WALLET_MESSAGE_SCHEMA.md
 */

import type { SupportedChainId } from './chains';
export const WALLET_TX_REQUEST_WIRE_TYPE = 'wallet_tx_request';
export const WALLET_TX_ANNOUNCEMENT_WIRE_TYPE = 'wallet_tx_announcement';

const SCHEMA_VERSION = 1;

/** Decimal string: integer part, `.fraction`, or leading-dot fraction (e.g. `.00001`). At least one digit required. */
const AMOUNT_REGEX = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;
const MAX_AMOUNT_LEN = 32;
const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

const NETWORKS = new Set<string>(['mainnet', 'arbitrum', 'optimism', 'gnosis', 'sepolia']);

const EVM_ADDR_REGEX = /^0x[a-fA-F0-9]{40}$/;

function isWireEvmAddress(s: unknown): s is string {
  return typeof s === 'string' && EVM_ADDR_REGEX.test(s.trim());
}

function isSupportedNetwork(s: unknown): s is SupportedChainId {
  return typeof s === 'string' && NETWORKS.has(s);
}

/** Ticker in DMs: ETH / USDC / USDT or an imported token symbol (uppercase alnum). */
function isWalletAssetLabel(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Z0-9]{1,16}$/.test(s);
}

function isValidAmountString(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (!t || t.length > MAX_AMOUNT_LEN) return false;
  return AMOUNT_REGEX.test(t);
}

function isValidTxHash(s: unknown): s is string {
  return typeof s === 'string' && TX_HASH_REGEX.test(s);
}

/** Minimal npub check for v1 payloads (bech32 `npub1…`). */
function isLikelyNpub(s: unknown): s is string {
  return typeof s === 'string' && s.startsWith('npub1') && s.length >= 16;
}

function isOptionalBlockNumber(s: unknown): s is string | undefined {
  if (s === undefined) return true;
  if (typeof s !== 'string') return false;
  return /^[0-9]+$/.test(s) && s.length <= 32;
}

export interface WalletTxRequestPayload {
  type: typeof WALLET_TX_REQUEST_WIRE_TYPE;
  version: typeof SCHEMA_VERSION;
  request_id: string;
  network: SupportedChainId;
  asset: string;
  amount: string;
  /** Posting user’s active EVM signer (`0x` + 40 hex). Required on the wire for v1. */
  from_evm_address: string;
  created_at_ms?: number;
}

export interface WalletTxAnnouncementPayload {
  type: typeof WALLET_TX_ANNOUNCEMENT_WIRE_TYPE;
  version: typeof SCHEMA_VERSION;
  network: SupportedChainId;
  asset: string;
  amount: string;
  tx_hash: string;
  from_npub: string;
  to_npub: string;
  /** EVM account that signed the transfer (`0x` + 40 hex). Required on the wire for v1. */
  from_evm_address: string;
  request_id?: string;
  block_number?: string;
}

export function formatWalletTxRequest(payload: Omit<WalletTxRequestPayload, 'type' | 'version'> & { version?: number }): string {
  const body: Record<string, unknown> = {
    version: SCHEMA_VERSION,
    type: WALLET_TX_REQUEST_WIRE_TYPE,
    request_id: payload.request_id,
    network: payload.network,
    asset: payload.asset,
    amount: payload.amount,
  };
  if (payload.created_at_ms != null) body.created_at_ms = payload.created_at_ms;
  const from = typeof payload.from_evm_address === 'string' ? payload.from_evm_address.trim() : '';
  if (!isWireEvmAddress(from)) {
    throw new Error('from_evm_address must be a 0x-prefixed 20-byte hex address');
  }
  body.from_evm_address = from;
  return JSON.stringify(body);
}

export function formatWalletTxAnnouncement(
  payload: Omit<WalletTxAnnouncementPayload, 'type' | 'version'> & { version?: number }
): string {
  const body: Record<string, unknown> = {
    version: SCHEMA_VERSION,
    type: WALLET_TX_ANNOUNCEMENT_WIRE_TYPE,
    network: payload.network,
    asset: payload.asset,
    amount: payload.amount,
    tx_hash: payload.tx_hash,
    from_npub: payload.from_npub,
    to_npub: payload.to_npub,
  };
  if (payload.request_id != null) body.request_id = payload.request_id;
  if (payload.block_number != null) body.block_number = payload.block_number;
  const from = typeof payload.from_evm_address === 'string' ? payload.from_evm_address.trim() : '';
  if (!isWireEvmAddress(from)) {
    throw new Error('from_evm_address must be a 0x-prefixed 20-byte hex address');
  }
  body.from_evm_address = from;
  return JSON.stringify(body);
}

/**
 * Parse DM `content` as a v1 `wallet_tx_request`. Returns null if invalid or wrong type.
 */
export function parseWalletTxRequest(content: string): WalletTxRequestPayload | null {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (o.type !== WALLET_TX_REQUEST_WIRE_TYPE) return null;
  if (o.version !== SCHEMA_VERSION) return null;
  if (typeof o.request_id !== 'string' || o.request_id.length === 0) return null;
  if (!isSupportedNetwork(o.network)) return null;
  if (!isWalletAssetLabel(o.asset)) return null;
  if (!isValidAmountString(o.amount)) return null;
  if (o.created_at_ms !== undefined) {
    if (typeof o.created_at_ms !== 'number' || !Number.isFinite(o.created_at_ms)) return null;
  }
  if (!isWireEvmAddress(o.from_evm_address)) return null;
  const out: WalletTxRequestPayload = {
    type: WALLET_TX_REQUEST_WIRE_TYPE,
    version: SCHEMA_VERSION,
    request_id: o.request_id,
    network: o.network,
    asset: o.asset,
    amount: o.amount.trim(),
    from_evm_address: (o.from_evm_address as string).trim(),
    ...(o.created_at_ms !== undefined ? { created_at_ms: o.created_at_ms } : {}),
  };
  return out;
}

/**
 * Parse DM `content` as a v1 `wallet_tx_announcement`. Returns null if invalid or wrong type.
 */
export function parseWalletTxAnnouncement(content: string): WalletTxAnnouncementPayload | null {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (o.type !== WALLET_TX_ANNOUNCEMENT_WIRE_TYPE) return null;
  if (o.version !== SCHEMA_VERSION) return null;
  if (!isSupportedNetwork(o.network)) return null;
  if (!isWalletAssetLabel(o.asset)) return null;
  if (!isValidAmountString(o.amount)) return null;
  if (!isValidTxHash(o.tx_hash)) return null;
  if (!isLikelyNpub(o.from_npub) || !isLikelyNpub(o.to_npub)) return null;
  if (o.request_id !== undefined && typeof o.request_id !== 'string') return null;
  if (!isOptionalBlockNumber(o.block_number)) return null;
  if (!isWireEvmAddress(o.from_evm_address)) return null;

  const out: WalletTxAnnouncementPayload = {
    type: WALLET_TX_ANNOUNCEMENT_WIRE_TYPE,
    version: SCHEMA_VERSION,
    network: o.network,
    asset: o.asset,
    amount: o.amount.trim(),
    tx_hash: o.tx_hash,
    from_npub: o.from_npub,
    to_npub: o.to_npub,
    from_evm_address: (o.from_evm_address as string).trim(),
  };
  if (typeof o.request_id === 'string' && o.request_id.length > 0) out.request_id = o.request_id;
  if (typeof o.block_number === 'string') out.block_number = o.block_number;
  return out;
}

/**
 * Collects `request_id` values from any `wallet_tx_announcement` in the thread that includes one.
 * Used to mark matching `wallet_tx_request` cards as paid without extra server metadata.
 */
export function getFulfilledWalletRequestIdsFromMessages(
  messages: ReadonlyArray<{ content?: string | null }>
): ReadonlySet<string> {
  const s = new Set<string>();
  for (const m of messages) {
    const ann = parseWalletTxAnnouncement(m.content ?? '');
    if (ann?.request_id) s.add(ann.request_id);
  }
  return s;
}

/** DM-only pairwise wallet exchange (not published on Kind 0). */
export const WALLET_PEER_INFO_REQUEST_WIRE_TYPE = 'wallet_peer_info_request';
export const WALLET_PEER_INFO_GRANT_WIRE_TYPE = 'wallet_peer_info_grant';
export const WALLET_PEER_INFO_DECLINE_WIRE_TYPE = 'wallet_peer_info_decline';

export interface WalletPeerInfoRequestPayload {
  type: typeof WALLET_PEER_INFO_REQUEST_WIRE_TYPE;
  version: typeof SCHEMA_VERSION;
  request_id: string;
  requester_npub: string;
  requester_evm_address: string;
}

export interface WalletPeerInfoGrantPayload {
  type: typeof WALLET_PEER_INFO_GRANT_WIRE_TYPE;
  version: typeof SCHEMA_VERSION;
  request_id: string;
  grantor_npub: string;
  evm_address: string;
}

export interface WalletPeerInfoDeclinePayload {
  type: typeof WALLET_PEER_INFO_DECLINE_WIRE_TYPE;
  version: typeof SCHEMA_VERSION;
  request_id: string;
}

export function formatWalletPeerInfoRequest(
  payload: Omit<WalletPeerInfoRequestPayload, 'type' | 'version'> & { version?: number }
): string {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    type: WALLET_PEER_INFO_REQUEST_WIRE_TYPE,
    request_id: payload.request_id,
    requester_npub: payload.requester_npub,
    requester_evm_address: payload.requester_evm_address.trim(),
  });
}

export function formatWalletPeerInfoGrant(
  payload: Omit<WalletPeerInfoGrantPayload, 'type' | 'version'> & { version?: number }
): string {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    type: WALLET_PEER_INFO_GRANT_WIRE_TYPE,
    request_id: payload.request_id,
    grantor_npub: payload.grantor_npub,
    evm_address: payload.evm_address.trim(),
  });
}

export function formatWalletPeerInfoDecline(
  payload: Omit<WalletPeerInfoDeclinePayload, 'type' | 'version'> & { version?: number }
): string {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    type: WALLET_PEER_INFO_DECLINE_WIRE_TYPE,
    request_id: payload.request_id,
  });
}

export function parseWalletPeerInfoRequest(content: string): WalletPeerInfoRequestPayload | null {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (o.type !== WALLET_PEER_INFO_REQUEST_WIRE_TYPE) return null;
  if (o.version !== SCHEMA_VERSION) return null;
  if (typeof o.request_id !== 'string' || o.request_id.length === 0) return null;
  if (!isLikelyNpub(o.requester_npub)) return null;
  if (!isWireEvmAddress(o.requester_evm_address)) return null;
  return {
    type: WALLET_PEER_INFO_REQUEST_WIRE_TYPE,
    version: SCHEMA_VERSION,
    request_id: o.request_id,
    requester_npub: o.requester_npub,
    requester_evm_address: o.requester_evm_address.trim(),
  };
}

export function parseWalletPeerInfoGrant(content: string): WalletPeerInfoGrantPayload | null {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (o.type !== WALLET_PEER_INFO_GRANT_WIRE_TYPE) return null;
  if (o.version !== SCHEMA_VERSION) return null;
  if (typeof o.request_id !== 'string' || o.request_id.length === 0) return null;
  if (!isLikelyNpub(o.grantor_npub)) return null;
  if (!isWireEvmAddress(o.evm_address)) return null;
  return {
    type: WALLET_PEER_INFO_GRANT_WIRE_TYPE,
    version: SCHEMA_VERSION,
    request_id: o.request_id,
    grantor_npub: o.grantor_npub,
    evm_address: o.evm_address.trim(),
  };
}

export function parseWalletPeerInfoDecline(content: string): WalletPeerInfoDeclinePayload | null {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (o.type !== WALLET_PEER_INFO_DECLINE_WIRE_TYPE) return null;
  if (o.version !== SCHEMA_VERSION) return null;
  if (typeof o.request_id !== 'string' || o.request_id.length === 0) return null;
  return {
    type: WALLET_PEER_INFO_DECLINE_WIRE_TYPE,
    version: SCHEMA_VERSION,
    request_id: o.request_id,
  };
}
