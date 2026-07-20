import { invoke } from '@tauri-apps/api/core';
import { sendDmMessage } from '../api/nostr';
import { getActiveSquadEvmSignerAddress, listEvmAccounts } from '../wallet/evm-accounts';
import { listEvmAccountSquadBindings } from './evm-account-squad-bindings';

export const SQUAD_MEMBER_EVM_SHARE_TYPE = 'squad_member_evm_share';
export const SQUAD_MEMBER_EVM_SHARE_VERSION = 1;

export function formatSquadMemberEvmShare(rosterParentId: string, evmAddress: string): string {
  return JSON.stringify({
    version: SQUAD_MEMBER_EVM_SHARE_VERSION,
    type: SQUAD_MEMBER_EVM_SHARE_TYPE,
    payload: { parent_id: rosterParentId, evm_address: evmAddress },
    pacto_virtual_bucket: 'announcements',
  });
}

/**
 * Prefer the #announcements MLS group id for roster DB + wire `parent_id` so all members share one key.
 * When the UI parent id differs (e.g. legacy placeholder squad id), pass it as `alt` for list queries.
 */
export function listSquadMemberEvmInvokeArgs(
  parentId: string,
  announcementsGroupId: string | null | undefined
): { parentId: string; altParentId?: string | null } {
  const p = parentId.trim();
  const a = announcementsGroupId?.trim() ?? '';
  if (a && a !== p) return { parentId: a, altParentId: p };
  if (a) return { parentId: a, altParentId: null };
  return { parentId: p, altParentId: null };
}

export type PublishSquadMemberEvmShareOptions = {
  /** If set, publish this address for the current user for this parent (e.g. Change signer). Otherwise uses wallet preference below. */
  evmAddress?: string | null;
  /** Optional UI parent id when it differs from the announcements roster key. */
  altParentId?: string | null;
};

/** Bound account address for this parent, if any (does not fall back to active WalletBar signer). */
export async function getBoundSquadEvmAddressForParent(
  parentId: string,
  altParentId?: string | null,
): Promise<string | null> {
  const candidates = [parentId.trim(), altParentId?.trim() ?? ''].filter(
    (id, i, arr) => !!id && arr.indexOf(id) === i,
  );
  if (candidates.length === 0) return null;
  try {
    const bindings = await listEvmAccountSquadBindings();
    const hit = candidates
      .map((pid) => bindings.find((b) => b.parentId.trim() === pid))
      .find((b) => b?.evmAccountId);
    if (!hit?.evmAccountId) return null;
    const rows = await listEvmAccounts();
    const addr = rows?.find((r) => r.id === hit.evmAccountId)?.address?.trim();
    return addr || null;
  } catch {
    return null;
  }
}

/**
 * Address to publish for this parent: explicit → bound account → resolve (binding/share/active) → active.
 * Preferring binding prevents Default WalletBar overwrites after fund-then-deploy.
 */
export async function resolveSquadMemberEvmShareAddress(
  announcementsMlsGroupId: string,
  options?: PublishSquadMemberEvmShareOptions,
): Promise<string | null> {
  const rosterId = announcementsMlsGroupId.trim();
  if (!rosterId) return null;
  const explicit = options?.evmAddress?.trim();
  if (explicit) return explicit;

  const bound = await getBoundSquadEvmAddressForParent(rosterId, options?.altParentId);
  if (bound) return bound;

  try {
    const resolved = await invoke<string | null>('resolve_squad_roster_evm_address', {
      parentId: rosterId,
      memberNpub: null,
    });
    if (resolved?.trim()) return resolved.trim();
  } catch {
    /* fall through */
  }
  return (await getActiveSquadEvmSignerAddress())?.trim() || null;
}

/**
 * Record the current user's squad roster signer for this parent and publish a `squad_member_evm_share` row to #announcements.
 * `announcementsMlsGroupId` is both the MLS destination and roster `parent_id` (must match for all members).
 */
export async function publishSquadMemberEvmShare(
  announcementsMlsGroupId: string,
  options?: PublishSquadMemberEvmShareOptions
): Promise<boolean> {
  const rosterId = announcementsMlsGroupId.trim();
  if (!rosterId) return false;
  const fromWallet = await resolveSquadMemberEvmShareAddress(rosterId, options);
  if (!fromWallet) return false;
  // Publish first so peers sync; local upsert only after MLS send succeeds.
  const json = formatSquadMemberEvmShare(rosterId, fromWallet);
  try {
    await sendDmMessage(rosterId, json, '', { virtualBucket: 'announcements' });
  } catch (e) {
    console.warn('[squad-member-evm] sendDmMessage failed', e);
    return false;
  }
  try {
    await invoke('upsert_squad_member_evm', { parentId: rosterId, evmAddress: fromWallet });
  } catch (e) {
    console.warn('[squad-member-evm] upsert_squad_member_evm failed after publish', e);
    return false;
  }
  return true;
}

/**
 * When the shared roster row disagrees with the local squad binding, republish the bound address.
 * Returns true when a heal publish ran successfully.
 */
export async function healSquadMemberEvmShareIfDiverged(
  announcementsMlsGroupId: string,
  shareByNpub: Record<string, string>,
  myNpub: string | null | undefined,
  altParentId?: string | null,
): Promise<boolean> {
  const rosterId = announcementsMlsGroupId.trim();
  const me = myNpub?.trim();
  if (!rosterId || !me) return false;

  const bound = await getBoundSquadEvmAddressForParent(rosterId, altParentId);
  if (!bound) return false;

  const share = shareByNpub[me]?.trim() ?? '';
  if (share && share.toLowerCase() === bound.toLowerCase()) return false;

  return publishSquadMemberEvmShare(rosterId, { evmAddress: bound, altParentId });
}
