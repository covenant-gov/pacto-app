/**
 * DM wallet message payloads: `wallet_tx_request` and `wallet_tx_announcement`.
 * Schema: docs/wallet/DM_WALLET_MESSAGE_SCHEMA.md
 */

import type { SupportedChainId } from './chains';
export const WALLET_TX_REQUEST_WIRE_TYPE = 'wallet_tx_request';
export const WALLET_TX_ANNOUNCEMENT_WIRE_TYPE = 'wallet_tx_announcement';

const SCHEMA_VERSION = 1;

const AMOUNT_REGEX = /^[0-9]+(\.[0-9]+)?$/;
const MAX_AMOUNT_LEN = 32;
const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

const NETWORKS = new Set<string>(['mainnet', 'optimism', 'sepolia']);

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
  return {
    type: WALLET_TX_REQUEST_WIRE_TYPE,
    version: SCHEMA_VERSION,
    request_id: o.request_id,
    network: o.network,
    asset: o.asset,
    amount: o.amount.trim(),
    ...(o.created_at_ms !== undefined ? { created_at_ms: o.created_at_ms } : {}),
  };
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

  const out: WalletTxAnnouncementPayload = {
    type: WALLET_TX_ANNOUNCEMENT_WIRE_TYPE,
    version: SCHEMA_VERSION,
    network: o.network,
    asset: o.asset,
    amount: o.amount.trim(),
    tx_hash: o.tx_hash,
    from_npub: o.from_npub,
    to_npub: o.to_npub,
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
