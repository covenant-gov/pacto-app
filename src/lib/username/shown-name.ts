import type { NostrProfile } from '../api/nostr';
import { getProfileDisplayName } from '../utils/profile';

export function nonZeroTokenId(tokenId: string | null | undefined): boolean {
  const t = tokenId?.trim();
  if (!t || t === '0' || t === '0x0' || t === '0x00') return false;
  try {
    return BigInt(t) !== 0n;
  } catch {
    return false;
  }
}

/** Chain username when the record is a minted claim. */
export function chainUsernameFromRecord(
  name: string | null | undefined,
  tokenId: string | null | undefined,
): string | null {
  const trimmed = name?.trim() ?? '';
  if (!trimmed || !nonZeroTokenId(tokenId)) return null;
  return trimmed;
}

/**
 * Chain name wins over nickname and kind 0 so the check sits on the unique string.
 * No chain name: nickname, then kind 0 name, then display_name, with no check.
 */
export function shownProfileName(
  profile: NostrProfile | null | undefined,
  chainName: string | null | undefined,
): { name: string; verified: boolean } {
  const chain = chainName?.trim() ?? '';
  if (chain) return { name: chain, verified: true };
  return { name: getProfileDisplayName(profile), verified: false };
}

export type ShownNameChainState = {
  /** Account the own record was read for. A mismatch is not this account's chain name. */
  npub?: string | null;
  record?: { name?: string | null; tokenId?: string | null } | null;
};

export type ShownNamePeerClaims = Record<string, { name: string | null } | undefined>;

/** Store snapshots for one shown-name lookup. Omit to use kind 0 only. */
export type ShownNameContext = {
  selfNpub?: string | null;
  usernameState?: ShownNameChainState | null;
  peerClaims?: ShownNamePeerClaims | null;
};

/**
 * Same minted-record rule for the signed-in account and everyone else.
 * A peer key that is absent or still loading contributes no chain name.
 */
export function resolveShownName(input: {
  npub: string;
  profile?: NostrProfile | null;
  chain?: ShownNameContext | null;
}): { name: string; verified: boolean } {
  const key = input.npub.trim();
  const self = input.chain?.selfNpub?.trim() ?? '';
  const own = input.chain?.usernameState;
  const ownNpub = own?.npub?.trim() ?? '';
  const minted =
    key && self && key === self
      ? ownNpub === self
        ? chainUsernameFromRecord(own?.record?.name, own?.record?.tokenId)
        : null
      : key
        ? (input.chain?.peerClaims?.[key]?.name ?? null)
        : null;
  return shownProfileName(input.profile, minted);
}
