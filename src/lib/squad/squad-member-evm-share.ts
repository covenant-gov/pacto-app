import { invoke } from '@tauri-apps/api/core';
import { getEvmAddress } from '../api/auth';
import { getActiveEvmSignerAddress } from '../wallet/evm-accounts';
import { sendDmMessage } from '../api/nostr';

export const SQUAD_MEMBER_EVM_SHARE_TYPE = 'squad_member_evm_share';
export const SQUAD_MEMBER_EVM_SHARE_VERSION = 1;

export function formatSquadMemberEvmShare(rosterParentId: string, evmAddress: string): string {
  return JSON.stringify({
    version: SQUAD_MEMBER_EVM_SHARE_VERSION,
    type: SQUAD_MEMBER_EVM_SHARE_TYPE,
    payload: { parent_id: rosterParentId, evm_address: evmAddress },
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
};

/**
 * Record the current user's preferred squad/network signer address (EVM) for this community and broadcast to #announcements.
 * `announcementsMlsGroupId` is both the MLS destination and the roster `parent_id` key (must match for all members).
 * Uses the **active EVM signing account** when `options.evmAddress` is omitted; falls back to the stored profile/wallet address.
 * Other members receive their own row when their client publishes (e.g. on invite accept). This does not change on-chain Safe owners.
 */
export async function publishSquadMemberEvmShare(
  announcementsMlsGroupId: string,
  options?: PublishSquadMemberEvmShareOptions
): Promise<boolean> {
  const rosterId = announcementsMlsGroupId.trim();
  if (!rosterId) return false;
  const explicit = options?.evmAddress?.trim();
  const fromWallet =
    explicit ||
    (await getActiveEvmSignerAddress())?.trim() ||
    (await getEvmAddress())?.trim() ||
    '';
  if (!fromWallet) return false;
  try {
    await invoke('upsert_squad_member_evm', { parentId: rosterId, evmAddress: fromWallet });
  } catch (e) {
    console.warn('[squad-member-evm] upsert_squad_member_evm failed', e);
    return false;
  }
  const json = formatSquadMemberEvmShare(rosterId, fromWallet);
  try {
    await sendDmMessage(rosterId, json);
  } catch (e) {
    console.warn('[squad-member-evm] sendDmMessage failed', e);
    return false;
  }
  return true;
}
