import { invoke } from '@tauri-apps/api/core';
import { getEvmAddress } from '../api/auth';
import { sendDmMessage } from '../api/nostr';

export const SQUAD_MEMBER_EVM_SHARE_TYPE = 'squad_member_evm_share';
export const SQUAD_MEMBER_EVM_SHARE_VERSION = 1;

export function formatSquadMemberEvmShare(parentId: string, evmAddress: string): string {
  return JSON.stringify({
    version: SQUAD_MEMBER_EVM_SHARE_VERSION,
    type: SQUAD_MEMBER_EVM_SHARE_TYPE,
    payload: { parent_id: parentId, evm_address: evmAddress },
  });
}

/** Persist locally and broadcast JSON to the announcements MLS group (receiver = MLS group id). */
export async function publishSquadMemberEvmShare(parentId: string, announcementsMlsGroupId: string): Promise<void> {
  const addr = await getEvmAddress();
  if (!addr?.trim()) return;
  const trimmed = addr.trim();
  try {
    await invoke('upsert_squad_member_evm', { parentId, evmAddress: trimmed });
  } catch (e) {
    console.warn('[squad-member-evm] upsert_squad_member_evm failed', e);
    return;
  }
  const json = formatSquadMemberEvmShare(parentId, trimmed);
  try {
    await sendDmMessage(announcementsMlsGroupId, json);
  } catch (e) {
    console.warn('[squad-member-evm] sendDmMessage failed', e);
  }
}
