import { invoke } from '@tauri-apps/api/core';
import {
  addEvmAccountRow,
  getActiveSquadEvmSignerAddress,
  isSquadPurposeAccount,
  listEvmAccounts,
} from '../wallet/evm-accounts';
import { publishSquadMemberEvmShare } from './squad-member-evm-share';

/** Bind the active squad-purpose signer to this parent and publish roster share to #announcements. */
export async function bindDefaultSquadSigner(announcementsGroupId: string): Promise<boolean> {
  const rosterId = announcementsGroupId.trim();
  if (!rosterId) return false;
  const rows = await listEvmAccounts();
  const active = rows?.find((r) => r.isActive && isSquadPurposeAccount(r));
  const addr = active?.address?.trim();
  if (!active?.id || !addr) return false;
  try {
    await invoke('upsert_squad_member_evm_account', {
      parentId: rosterId,
      evmAccountId: active.id,
    });
  } catch (e) {
    console.warn('[squad-roster] upsert default binding failed', e);
    return false;
  }
  return publishSquadMemberEvmShare(rosterId, { evmAddress: addr });
}

/** Create a new squad-purpose derived account for this parent without changing global active signer. */
export async function bindNewSquadKey(announcementsGroupId: string, label = 'Squad key'): Promise<boolean> {
  const rosterId = announcementsGroupId.trim();
  if (!rosterId) return false;
  let row;
  try {
    row = await addEvmAccountRow({
      label,
      setActiveSigner: false,
      setDefaultShared: false,
      purpose: 'squad',
    });
  } catch (e) {
    console.warn('[squad-roster] add squad account failed', e);
    return false;
  }
  const addr = row.address?.trim();
  if (!row.id || !addr) return false;
  try {
    await invoke('upsert_squad_member_evm_account', {
      parentId: rosterId,
      evmAccountId: row.id,
    });
  } catch (e) {
    console.warn('[squad-roster] upsert new-key binding failed', e);
    return false;
  }
  return publishSquadMemberEvmShare(rosterId, { evmAddress: addr });
}

/** Resolve roster-bound address for deploy/co-owner flows (binding → roster row → active squad signer). */
export async function resolveSquadRosterEvmAddress(
  parentId: string,
  memberNpub?: string | null
): Promise<string | null> {
  const pid = parentId.trim();
  if (!pid) return null;
  try {
    const addr = await invoke<string | null>('resolve_squad_roster_evm_address', {
      parentId: pid,
      memberNpub: memberNpub?.trim() || null,
    });
    return addr?.trim() || null;
  } catch {
    return (await getActiveSquadEvmSignerAddress())?.trim() || null;
  }
}
