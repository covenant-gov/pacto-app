/**
 * Announcement message format for # announcements channel.
 * Messages are JSON: { type: string, payload: object }.
 * Backend and frontend parse by type and act accordingly.
 * Applies to both squads and networks (parent = squad or network).
 */

import { SQUAD_MEMBER_EVM_SHARE_TYPE } from './squad/squad-member-evm-share';

/** Roster sync: member shared preferred EVM signer for this parent ({@link SQUAD_MEMBER_EVM_SHARE_TYPE}). */
export const ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE = SQUAD_MEMBER_EVM_SHARE_TYPE;

/** Wire format: "squad_safe_updated". Payload.squad_id is the parent id (squad or network). */
export const ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED = 'squad_safe_updated';
/** Alias for parent-agnostic code. Same value as ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED. */
export const ANNOUNCE_TYPE_SAFE_UPDATED = ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED;

/** Wire format for new Safe proposal. Payload includes parent_id, to, amount, token, proposer_npub, id. */
export const ANNOUNCE_TYPE_SAFE_PROPOSAL = 'safe_proposal';

/** New dashboard poll posted to the announcements MLS group; vote in Dashboard → Polls. */
export const ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED = 'dashboard_poll_created';

/** Squad/network deployed infra sync (`squad_infra` SQLite rows). Wire: `governance_updated`. */
export const ANNOUNCE_TYPE_GOVERNANCE_UPDATED = 'governance_updated';

/** Payload for `governance_updated`. `parent_id` is the squad or network root id. */
export interface GovernanceUpdatedPayload {
  parent_id: string;
  /** `pacto_gov` | `gnosis_safe` | `bread_coop` | `sponsor` (normalized server-side where applicable). */
  provider: string;
  /** Hat tree id, sponsor clone address, Safe sentinel, etc.; required non-empty on wire. */
  canonical_ref: string;
  /** Stable squad infra row id for multi-row merge (optional on wire until all clients emit it). */
  entry_id?: string;
  /** `sepolia` | `mainnet` | `arbitrum` | `local` — defaults server-side when omitted. */
  chain?: string;
  /** Upstream pacto-gov git commit at deploy time (optional). */
  pacto_gov_revision?: string;
  /** JSON string metadata (tx hash, addresses map, etc.). */
  provider_payload?: string;
}
/** Payload for safe_updated announce. squad_id in JSON is the parent id (squad or network). */
export interface SquadSafeUpdatedPayload {
  squad_id: string;
  safe_address: string;
  /** `sepolia` | `mainnet` | `arbitrum` | `local` (normalized server-side). */
  chain?: string;
  label?: string;
  /** Stable row id for first insert; optional. */
  entry_id?: string;
  /** Set when the Safe was created via factory deploy; `0x` + 64 hex. */
  tx_hash?: string;
  /**
   * Optional absolute URL to the deployment transaction on a block explorer.
   * Clients may omit this and derive a link from `chain` + `tx_hash`.
   */
  explorer_tx_url?: string;
}
/** Alias for parent-agnostic code. Same shape as SquadSafeUpdatedPayload. */
export type SafeUpdatedPayload = SquadSafeUpdatedPayload;

/**
 * Proposal payload: single transfer (to, amount, token). Broadcast to # announcements so all members see it.
 * parent_id = squad or network id (resolves Safe and channel). proposer_npub = creator's npub.
 */
export interface SafeProposalPayload {
  id: string;
  parent_id: string;
  to: string;
  amount: string;
  /** "ETH" or token contract address */
  token: string;
  proposer_npub: string;
  /** Optional: created_at ms for ordering */
  created_at?: number;
}

/** Payload for squad_member_evm_share (may include optional version on wire JSON root). */
export interface SquadMemberEvmSharePayload {
  parent_id: string;
  evm_address: string;
}

/** Payload for dashboard_poll_created (matches MLS rumor JSON). */
export interface DashboardPollCreatedPayload {
  parent_id: string;
  poll_id: string;
  title: string;
  description?: string;
  options: { id: string; label: string }[];
}

export type AnnouncePayload =
  | SquadSafeUpdatedPayload
  | SafeProposalPayload
  | SquadMemberEvmSharePayload
  | DashboardPollCreatedPayload
  | GovernanceUpdatedPayload;

/** Discriminated union of all announcement message types. */
export type AnnounceMessage =
  | { type: typeof ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED; payload: SquadSafeUpdatedPayload }
  | { type: typeof ANNOUNCE_TYPE_SAFE_PROPOSAL; payload: SafeProposalPayload }
  | { type: typeof ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE; payload: SquadMemberEvmSharePayload }
  | { type: typeof ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED; payload: DashboardPollCreatedPayload }
  | { type: typeof ANNOUNCE_TYPE_GOVERNANCE_UPDATED; payload: GovernanceUpdatedPayload };

export function isSponsorGovernanceProvider(provider: string): boolean {
  return provider.trim().toLowerCase() === 'sponsor';
}

export function isSponsorGovernanceAnnounce(msg: AnnounceMessage): boolean {
  return (
    msg.type === ANNOUNCE_TYPE_GOVERNANCE_UPDATED &&
    isSponsorGovernanceProvider(msg.payload.provider)
  );
}

function isSquadSafeUpdatedPayload(p: unknown): p is SquadSafeUpdatedPayload {
  return (
    p != null &&
    typeof p === 'object' &&
    typeof (p as SquadSafeUpdatedPayload).squad_id === 'string' &&
    typeof (p as SquadSafeUpdatedPayload).safe_address === 'string'
  );
}

function isSafeProposalPayload(p: unknown): p is SafeProposalPayload {
  if (!p || typeof p !== 'object') return false;
  const q = p as Record<string, unknown>;
  return (
    typeof q.id === 'string' &&
    typeof q.parent_id === 'string' &&
    typeof q.to === 'string' &&
    typeof q.amount === 'string' &&
    typeof q.token === 'string' &&
    typeof q.proposer_npub === 'string'
  );
}

function isSquadMemberEvmSharePayload(p: unknown): p is SquadMemberEvmSharePayload {
  if (!p || typeof p !== 'object') return false;
  const q = p as Record<string, unknown>;
  return (
    typeof q.parent_id === 'string' &&
    q.parent_id.trim().length > 0 &&
    typeof q.evm_address === 'string' &&
    q.evm_address.trim().length > 0
  );
}

function isDashboardPollCreatedPayload(p: unknown): p is DashboardPollCreatedPayload {
  if (!p || typeof p !== 'object') return false;
  const q = p as Record<string, unknown>;
  if (
    typeof q.parent_id !== 'string' ||
    !q.parent_id.trim() ||
    typeof q.poll_id !== 'string' ||
    !q.poll_id.trim() ||
    typeof q.title !== 'string' ||
    !q.title.trim()
  ) {
    return false;
  }
  if (!Array.isArray(q.options) || q.options.length < 2) return false;
  for (const opt of q.options) {
    if (!opt || typeof opt !== 'object') return false;
    const o = opt as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.label !== 'string') return false;
    if (!o.id.trim() || !o.label.trim()) return false;
  }
  return true;
}

function isGovernanceUpdatedPayload(p: unknown): p is GovernanceUpdatedPayload {
  if (!p || typeof p !== 'object') return false;
  const q = p as Record<string, unknown>;
  return (
    typeof q.parent_id === 'string' &&
    q.parent_id.trim().length > 0 &&
    typeof q.provider === 'string' &&
    q.provider.trim().length > 0 &&
    typeof q.canonical_ref === 'string' &&
    q.canonical_ref.trim().length > 0
  );
}

/**
 * Parse message content as an announcement. Returns null if not valid announcement JSON or unknown type.
 */
export function parseAnnouncement(content: string): AnnounceMessage | null {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed) || !('payload' in parsed)) return null;
  const type = (parsed as { type: unknown }).type;
  const payload = (parsed as { payload: unknown }).payload;
  if (type === ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED && isSquadSafeUpdatedPayload(payload)) {
    return { type: ANNOUNCE_TYPE_SQUAD_SAFE_UPDATED, payload };
  }
  if (type === ANNOUNCE_TYPE_SAFE_PROPOSAL && isSafeProposalPayload(payload)) {
    return { type: ANNOUNCE_TYPE_SAFE_PROPOSAL, payload };
  }
  if (type === ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE && isSquadMemberEvmSharePayload(payload)) {
    return { type: ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE, payload };
  }
  if (type === ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED && isDashboardPollCreatedPayload(payload)) {
    return { type: ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED, payload };
  }
  if (type === ANNOUNCE_TYPE_GOVERNANCE_UPDATED && isGovernanceUpdatedPayload(payload)) {
    return { type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED, payload };
  }
  return null;
}

/**
 * Build content string for posting an announcement (e.g. from Set Safe flow or Create proposal).
 * Squad sponsor deploys use `announcements`; other governance automation uses `inbox`.
 */
export function buildAnnounceContent<T extends AnnounceMessage>(
  msg: T,
  options?: { virtualBucket?: 'announcements' | 'inbox' | 'polls' }
): string {
  const pacto_virtual_bucket =
    options?.virtualBucket ??
    (msg.type === ANNOUNCE_TYPE_DASHBOARD_POLL_CREATED
      ? 'announcements'
      : isSponsorGovernanceAnnounce(msg)
        ? 'announcements'
        : 'inbox');
  return JSON.stringify({ pacto_virtual_bucket, type: msg.type, payload: msg.payload });
}

/**
 * Proposal with message metadata (id, at) for display and resolving by parent.
 */
export interface ProposalWithMeta {
  id: string;
  messageId: string;
  at: number;
  payload: SafeProposalPayload;
}

/**
 * Extract all safe_proposal announcements from a list of channel messages.
 * Use to resolve "pending proposals" for a parent's # announcements channel.
 */
export function getProposalsFromMessages(
  messages: Array<{ id: string; content: string; at: number }>,
  parentId?: string
): ProposalWithMeta[] {
  const out: ProposalWithMeta[] = [];
  for (const msg of messages) {
    const parsed = parseAnnouncement(msg.content);
    if (parsed?.type !== ANNOUNCE_TYPE_SAFE_PROPOSAL) continue;
    if (parentId != null && parsed.payload.parent_id !== parentId) continue;
    out.push({
      id: parsed.payload.id,
      messageId: msg.id,
      at: msg.at,
      payload: parsed.payload,
    });
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}
