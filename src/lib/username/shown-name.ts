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
 * No chain name: today's display order, with no check.
 */
export function shownProfileName(
  profile: NostrProfile | null | undefined,
  chainName: string | null | undefined,
): { name: string; verified: boolean } {
  const chain = chainName?.trim() ?? '';
  if (chain) return { name: chain, verified: true };
  return { name: getProfileDisplayName(profile), verified: false };
}
