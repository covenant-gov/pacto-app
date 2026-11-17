import { derived, get, writable } from 'svelte/store';
import { t } from 'svelte-i18n';
import {
  usernameCancelAddressTransfer,
  usernameClaim,
  usernameClaimAddressTransfer,
  usernameInitiateAddressTransfer,
  usernameSyncAccountState,
  type UsernameClaimResult,
  type UsernameClaimRow,
  type UsernameRecordDto,
  type UsernameTransferResult,
} from '../lib/api/username';
import { npubHashFromPubkey } from '../lib/evm/sponsor/nostr_claim_link';
import { getActiveSquadEvmSignerAddress } from '../lib/wallet/evm-accounts';
import { ZERO_ADDRESS } from '../lib/wallet/assets';
import { getInvokeErrorMessage } from '../lib/utils/tauri-errors';
import { chainUsernameFromRecord } from '../lib/username/shown-name';
import { usernameClaimErrorMessage } from '../lib/username/username-claim-errors';
import { publishBoundUsername } from '../lib/api/nostr';
import { currentUser } from './auth-session';
import { profiles } from './profiles';
import type { Hex } from 'viem';

/** Only Sepolia has pinned `globalUsernameSponsor` addresses. */
export const USERNAME_NETWORK = 'sepolia';

export type UsernameStatus = 'idle' | 'loading' | 'ready' | 'error';

export type UsernameState = {
  /** Account this snapshot was read for. A mismatch is not a shown name. */
  npub: string | null;
  status: UsernameStatus;
  cached: UsernameClaimRow | null;
  record: UsernameRecordDto | null;
  pendingTransfer: boolean;
  activeEvm: string | null;
  busy: boolean;
  error: string | null;
};

const initialState: UsernameState = {
  npub: null,
  status: 'idle',
  cached: null,
  record: null,
  pendingTransfer: false,
  activeEvm: null,
  busy: false,
  error: null,
};

export const usernameState = writable<UsernameState>(initialState);

/** Set when the chain claim succeeded and the kind 0 bind publish did not. */
export const usernameKind0BindError = writable<string | null>(null);

function normalizeHexAddr(addr: string | null | undefined): string | null {
  const t = addr?.trim().toLowerCase();
  if (!t || !/^0x[0-9a-f]{40}$/.test(t)) return null;
  return t;
}

function isNonZeroTokenId(tokenId: string | null | undefined): boolean {
  const t = tokenId?.trim();
  if (!t) return false;
  if (t === '0' || t === '0x0' || t === '0x00') return false;
  try {
    return BigInt(t) !== 0n;
  } catch {
    return t !== '0';
  }
}

function isPendingAddress(addr: string | null | undefined): boolean {
  const n = normalizeHexAddr(addr);
  return !!n && n !== ZERO_ADDRESS.toLowerCase();
}

/** Pure verified check for unit tests and derived store. */
export function computeUsernameVerified(input: {
  linkEventId: string | null | undefined;
  record: UsernameRecordDto | null | undefined;
  activeEvm: string | null | undefined;
}): boolean {
  const link = input.linkEventId?.trim();
  if (!link) return false;
  const rec = input.record;
  if (!rec) return false;
  if (!rec.name?.trim()) return false;
  if (!isNonZeroTokenId(rec.tokenId)) return false;
  const chainEvm = normalizeHexAddr(rec.evmAddress);
  const active = normalizeHexAddr(input.activeEvm);
  if (!chainEvm || !active) return false;
  return chainEvm === active;
}

function signedInNpub(npub: string | null | undefined = get(currentUser)?.npub): string {
  return npub?.trim() ?? '';
}

/** Minted `recordOf` name for the signed-in account. The active signer is not part of it. */
export function mintedUsernameFromState(
  state: UsernameState,
  signedIn: string | null | undefined = get(currentUser)?.npub,
): string | null {
  const npub = signedInNpub(signedIn);
  if (!state.npub || state.npub !== npub) return null;
  return chainUsernameFromRecord(state.record?.name, state.record?.tokenId);
}

export function claimedUsernameFromState(state: UsernameState): string | null {
  const fromRecord = state.record?.name?.trim();
  if (fromRecord && isNonZeroTokenId(state.record?.tokenId)) return fromRecord;
  const fromCache = state.cached?.username?.trim();
  if (fromCache && isNonZeroTokenId(state.cached?.tokenId)) return fromCache;
  return null;
}

/** Claimed holder, missing link id, this pass read a minted chain record. */
export function needsForcedUsernameLinkRestore(state: UsernameState): boolean {
  const npub = signedInNpub();
  if (!state.npub || state.npub !== npub) return false;
  if (!claimedUsernameFromState(state)) return false;
  if (
    computeUsernameVerified({
      linkEventId: state.cached?.linkEventId,
      record: state.record,
      activeEvm: state.activeEvm,
    })
  ) {
    return false;
  }
  if (state.cached?.linkEventId?.trim()) return false;
  const rec = state.record;
  return !!rec?.name?.trim() && isNonZeroTokenId(rec.tokenId);
}

export const claimedUsername = derived([usernameState, currentUser], ([$s, $user]) => {
  if (!$s.npub || $s.npub !== signedInNpub($user?.npub)) return null;
  return claimedUsernameFromState($s);
});

export const isUsernameVerified = derived(usernameState, ($s) =>
  computeUsernameVerified({
    linkEventId: $s.cached?.linkEventId,
    record: $s.record,
    activeEvm: $s.activeEvm,
  }),
);

export const hasPendingUsernameTransfer = derived(usernameState, ($s) => {
  if ($s.pendingTransfer) return true;
  return isPendingAddress($s.record?.pendingAddress);
});

let ownUsernameRefresh: Promise<void> | null = null;
let ownUsernameRefreshNpub: string | null = null;

export function resetUsernameState(): void {
  refreshGen += 1;
  ownUsernameRefresh = null;
  ownUsernameRefreshNpub = null;
  usernameState.set({ ...initialState });
  usernameKind0BindError.set(null);
}

/** Write the chain username into kind 0 `name` and `display_name`. */
export async function publishBoundDisplayName(name: string): Promise<void> {
  const trimmed = normalizeUsernameInput(name);
  if (!trimmed) return;
  const npub = get(currentUser)?.npub;
  const profile = npub ? get(profiles)[npub] : undefined;
  await publishBoundUsername({
    name: trimmed,
    avatar: profile?.avatar ?? '',
    banner: profile?.banner ?? '',
    about: profile?.about ?? '',
  });
  usernameKind0BindError.set(null);
}

let refreshGen = 0;

/** Require 32-byte hex pubkey (optional 0x). Rejects bech32 npub. */
export function ensurePubkeyHex(pubkey: string): Hex {
  const raw = pubkey.trim();
  if (raw.toLowerCase().startsWith('npub1')) {
    throw new Error(get(t)('profile.username.errors.pubkeyGotNpub'));
  }
  const body = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(body)) {
    throw new Error(get(t)('profile.username.errors.pubkeyNotHex'));
  }
  return `0x${body.toLowerCase()}` as Hex;
}

/** On-chain username: trim only (case and charset are significant; Kind 0 display name is separate). */
export function normalizeUsernameInput(name: string): string {
  return name.trim();
}

/** One automatic chain read for the signed-in account. Explicit refreshes stay separate. */
export function ensureOwnUsername(): void {
  const npub = signedInNpub();
  if (!npub) return;
  if (ownUsernameRefresh && ownUsernameRefreshNpub === npub) return;
  const state = get(usernameState);
  if (state.npub && state.npub !== npub) {
    usernameState.set({ ...initialState, status: 'loading', npub });
  }
  ownUsernameRefreshNpub = npub;
  ownUsernameRefresh = refreshUsernameState();
}

export async function refreshUsernameState(options?: {
  forceLinkRestore?: boolean;
}): Promise<void> {
  const user = get(currentUser);
  const npub = signedInNpub(user?.npub);
  if (!user?.pubkey || !npub) {
    resetUsernameState();
    return;
  }

  const gen = ++refreshGen;
  const prevAtStart = get(usernameState);

  usernameState.update((s) => {
    if (s.npub && s.npub !== npub) {
      return { ...initialState, status: 'loading', npub };
    }
    return {
      ...s,
      npub,
      status: s.status === 'ready' ? 'ready' : 'loading',
      error: null,
    };
  });

  try {
    const [synced, activeEvm] = await Promise.all([
      usernameSyncAccountState(USERNAME_NETWORK, undefined, options),
      getActiveSquadEvmSignerAddress(),
    ]);
    if (gen !== refreshGen) return;
    if (!stillSignedIn(npub, prevAtStart)) return;

    const prev = get(usernameState);
    const chainUnread = synced.record == null && !!synced.chainError;
    const keepPrev = chainUnread && prev.npub === npub;
    usernameState.set({
      npub,
      status: 'ready',
      cached: synced.cached,
      record: synced.record ?? (keepPrev ? prev.record : null),
      pendingTransfer:
        synced.record != null
          ? synced.pendingTransfer
          : keepPrev
            ? prev.pendingTransfer
            : false,
      activeEvm,
      busy: false,
      error: null,
    });
  } catch (e) {
    if (gen !== refreshGen) return;
    if (!stillSignedIn(npub, prevAtStart)) return;
    usernameState.update((s) => ({
      ...s,
      npub,
      status: 'error',
      busy: false,
      error: getInvokeErrorMessage(e),
    }));
  }
}

/** Drop the write when the account changed. A lock keeps the snapshot from before this read. */
function stillSignedIn(npub: string, prevAtStart: UsernameState): boolean {
  const still = signedInNpub();
  if (still === npub) return true;
  if (!still && prevAtStart.npub === npub) usernameState.set(prevAtStart);
  return false;
}

async function withBusyWrite<T>(fn: () => Promise<T>): Promise<T> {
  usernameState.update((s) => ({ ...s, busy: true, error: null }));
  try {
    const result = await fn();
    await refreshUsernameState();
    usernameState.update((s) => ({ ...s, busy: false }));
    return result;
  } catch (e) {
    const message = usernameClaimErrorMessage(e);
    usernameState.update((s) => ({ ...s, busy: false, error: message }));
    throw e;
  }
}

export async function claimUsername(name: string): Promise<UsernameClaimResult> {
  const normalized = normalizeUsernameInput(name);
  const claimForNpub = signedInNpub();
  const result = await withBusyWrite(() => usernameClaim(USERNAME_NETWORK, normalized));
  if (!claimForNpub || signedInNpub() !== claimForNpub) return result;
  try {
    await publishBoundDisplayName(normalized);
  } catch (e) {
    usernameKind0BindError.set(getInvokeErrorMessage(e));
  }
  return result;
}

function resolveNpubHash(): string {
  const fromCache = get(usernameState).cached?.npubHash?.trim();
  if (fromCache) return fromCache;
  const pubkey = get(currentUser)?.pubkey;
  if (!pubkey) throw new Error('npub hash unavailable');
  return npubHashFromPubkey(ensurePubkeyHex(pubkey));
}

export async function initiateUsernameAddressTransfer(
  newAddress: string,
): Promise<UsernameTransferResult> {
  const hash = resolveNpubHash();
  return withBusyWrite(() =>
    usernameInitiateAddressTransfer(USERNAME_NETWORK, hash, newAddress.trim()),
  );
}

export async function claimUsernameAddressTransfer(): Promise<UsernameTransferResult> {
  const hash = resolveNpubHash();
  return withBusyWrite(() => usernameClaimAddressTransfer(USERNAME_NETWORK, hash));
}

export async function cancelUsernameAddressTransfer(): Promise<UsernameTransferResult> {
  const hash = resolveNpubHash();
  return withBusyWrite(() => usernameCancelAddressTransfer(USERNAME_NETWORK, hash));
}

/** Non-empty after trim; at most 64 UTF-8 bytes (chain has no charset rules). */
export function isValidUsernameFormat(name: string): boolean {
  const n = normalizeUsernameInput(name);
  if (!n) return false;
  return new TextEncoder().encode(n).length <= 64;
}
