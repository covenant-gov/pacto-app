/**
 * Persisted invite decisions (squad, network, channel-invite) and local DM wallet request responses.
 * Channel invites are unified: one accept/decline store for channels in squads or networks.
 * Wire up via initInviteDecisionPersistence(getKey); load via getInviteDecisionLoadEntries(npub).
 */

import { writable } from 'svelte/store';

export type PersistenceKeyGetter = (prefix: string) => string | null;

/** Npub-scoped localStorage key prefixes for invite accept/decline lists. */
export const INVITE_DECISION_SCOPED_PREFIXES = [
  'pacto_invite_accepted_squad',
  'pacto_invite_declined_squad',
  'pacto_invite_accepted_network',
  'pacto_invite_declined_network',
  'pacto_invite_accepted_channel',
  'pacto_invite_declined_channel',
  'pacto_wallet_tx_request_accepted',
  'pacto_wallet_tx_request_declined',
  'pacto_wallet_peer_info_request_accepted',
  'pacto_wallet_peer_info_request_declined',
] as const;

export const acceptedSquadInviteIds = writable<string[]>([]);
export const declinedSquadInviteIds = writable<string[]>([]);
export const acceptedNetworkInviteIds = writable<string[]>([]);
export const declinedNetworkInviteIds = writable<string[]>([]);
/** Unified: message IDs for accepted channel invites (squad or network). */
export const acceptedChannelInviteMessageIds = writable<string[]>([]);
/** Unified: message IDs for declined channel invites (squad or network). */
export const declinedChannelInviteMessageIds = writable<string[]>([]);
/** DM `wallet_tx_request` messages the user accepted (opens pre-filled send + links announcement via `request_id`). */
export const acceptedWalletTxRequestMessageIds = writable<string[]>([]);
/** DM `wallet_tx_request` messages the user declined. */
export const declinedWalletTxRequestMessageIds = writable<string[]>([]);
/** DM `wallet_peer_info_request` messages the user accepted (sent grant back). */
export const acceptedWalletPeerInfoRequestMessageIds = writable<string[]>([]);
/** DM `wallet_peer_info_request` messages the user declined. */
export const declinedWalletPeerInfoRequestMessageIds = writable<string[]>([]);

const STORES = [
  acceptedSquadInviteIds,
  declinedSquadInviteIds,
  acceptedNetworkInviteIds,
  declinedNetworkInviteIds,
  acceptedChannelInviteMessageIds,
  declinedChannelInviteMessageIds,
  acceptedWalletTxRequestMessageIds,
  declinedWalletTxRequestMessageIds,
  acceptedWalletPeerInfoRequestMessageIds,
  declinedWalletPeerInfoRequestMessageIds,
] as const;

function persist(prefix: string, ids: string[], getKey: PersistenceKeyGetter): void {
  if (typeof localStorage === 'undefined') return;
  const key = getKey(prefix);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

/**
 * Call once at app init with the app's persistence key getter (e.g. persistenceKey from app.ts).
 * Subscribes each store to persist to npub-scoped localStorage.
 */
export function initInviteDecisionPersistence(getKey: PersistenceKeyGetter): void {
  INVITE_DECISION_SCOPED_PREFIXES.forEach((prefix, i) => {
    STORES[i].subscribe((v) => persist(prefix, v, getKey));
  });
}

/**
 * Entries for loadAccountState: [localStorage key, setStore] for each invite decision store.
 */
export function getInviteDecisionLoadEntries(
  npub: string
): ReadonlyArray<[string, (v: string[]) => void]> {
  return INVITE_DECISION_SCOPED_PREFIXES.map((prefix, i) => [
    `${prefix}_${npub}`,
    (v: string[]) => STORES[i].set(v),
  ]);
}
