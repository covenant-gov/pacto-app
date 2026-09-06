import { derived, get, writable } from 'svelte/store';
import {
  usernameCancelAddressTransfer,
  usernameClaim,
  usernameClaimAddressTransfer,
  usernameGetCachedClaim,
  usernameInitiateAddressTransfer,
  usernameIsPendingTransfer,
  usernameRecordOf,
  type UsernameClaimResult,
  type UsernameClaimRow,
  type UsernameRecordDto,
  type UsernameTransferResult,
} from '../lib/api/username';
import { npubHashFromPubkey } from '../lib/evm/sponsor/nostr_claim_link';
import { getActiveSquadEvmSignerAddress } from '../lib/wallet/evm-accounts';
import { ZERO_ADDRESS } from '../lib/wallet/assets';
import { getInvokeErrorMessage } from '../lib/utils/tauri-errors';
import { usernameClaimErrorMessage } from '../lib/username/username-claim-errors';
import { currentUser } from './auth';
import type { Hex } from 'viem';

/** Only Sepolia has pinned `globalUsernameSponsor` addresses. */
export const USERNAME_NETWORK = 'sepolia';

export type UsernameStatus = 'idle' | 'loading' | 'ready' | 'error';

export type UsernameState = {
  status: UsernameStatus;
  cached: UsernameClaimRow | null;
  record: UsernameRecordDto | null;
  pendingTransfer: boolean;
  activeEvm: string | null;
  busy: boolean;
  error: string | null;
};

const initialState: UsernameState = {
  status: 'idle',
  cached: null,
  record: null,
  pendingTransfer: false,
  activeEvm: null,
  busy: false,
  error: null,
};

export const usernameState = writable<UsernameState>(initialState);

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

export function claimedUsernameFromState(state: UsernameState): string | null {
  const fromRecord = state.record?.name?.trim();
  if (fromRecord && isNonZeroTokenId(state.record?.tokenId)) return fromRecord;
  const fromCache = state.cached?.username?.trim();
  if (fromCache && isNonZeroTokenId(state.cached?.tokenId)) return fromCache;
  return null;
}

export const claimedUsername = derived(usernameState, ($s) => claimedUsernameFromState($s));

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

export function resetUsernameState(): void {
  refreshGen += 1;
  usernameState.set({ ...initialState });
}

let refreshGen = 0;

/** Require 32-byte hex pubkey (optional 0x). Rejects bech32 npub. */
export function ensurePubkeyHex(pubkey: string): Hex {
  const raw = pubkey.trim();
  if (raw.toLowerCase().startsWith('npub1')) {
    throw new Error('pubkey must be 32 bytes hex (got npub)');
  }
  const body = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(body)) {
    throw new Error('pubkey must be 32 bytes hex');
  }
  return `0x${body.toLowerCase()}` as Hex;
}

/** On-chain username: trim only (case and charset are significant; Kind 0 display name is separate). */
export function normalizeUsernameInput(name: string): string {
  return name.trim();
}

export async function refreshUsernameState(): Promise<void> {
  const user = get(currentUser);
  if (!user?.pubkey) {
    resetUsernameState();
    return;
  }

  const gen = ++refreshGen;

  usernameState.update((s) => ({
    ...s,
    status: s.status === 'ready' ? 'ready' : 'loading',
    error: null,
  }));

  try {
    const [cached, activeEvm] = await Promise.all([
      usernameGetCachedClaim(),
      getActiveSquadEvmSignerAddress(),
    ]);
    if (gen !== refreshGen) return;

    let npubHash = cached?.npubHash?.trim() || '';
    if (!npubHash) {
      npubHash = npubHashFromPubkey(ensurePubkeyHex(user.pubkey));
    }

    const prev = get(usernameState);
    let record: UsernameRecordDto | null = prev.record;
    let pendingTransfer = prev.pendingTransfer;
    try {
      const [rec, pending] = await Promise.all([
        usernameRecordOf(USERNAME_NETWORK, npubHash),
        usernameIsPendingTransfer(USERNAME_NETWORK, npubHash),
      ]);
      record = rec;
      pendingTransfer = pending;
    } catch {
      // Chain reads can fail offline; keep last-known record + cache.
    }
    if (gen !== refreshGen) return;

    usernameState.set({
      status: 'ready',
      cached,
      record,
      pendingTransfer,
      activeEvm,
      busy: false,
      error: null,
    });
  } catch (e) {
    if (gen !== refreshGen) return;
    usernameState.update((s) => ({
      ...s,
      status: 'error',
      busy: false,
      error: getInvokeErrorMessage(e),
    }));
  }
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
  return withBusyWrite(() => usernameClaim(USERNAME_NETWORK, normalized));
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
