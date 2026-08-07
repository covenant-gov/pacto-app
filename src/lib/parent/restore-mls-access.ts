/**
 * Re-run MLS invite for a member who may already hold a leaf.
 * Backend `add_member_device` classifies that as Restore (remove-then-re-add).
 */

import { inviteMemberToGroup } from '../api/nostr';
import { bumpMembershipVersion } from '../../stores/mls-chat';
import { refreshMlsGroupMembers } from '../../stores/mls-group-members';
import { getInvokeErrorMessage, friendlyMessage } from '../utils/tauri-errors';

export type RestoreMlsAccessResult = { ok: true } | { ok: false; error: string };

export async function restoreMlsMemberAccess(
  groupId: string,
  memberNpub: string,
): Promise<RestoreMlsAccessResult> {
  const gid = groupId.trim();
  const npub = memberNpub.trim();
  if (!gid || !npub) {
    return { ok: false, error: 'Missing group or member.' };
  }
  try {
    await inviteMemberToGroup(gid, npub);
    bumpMembershipVersion(gid);
    await refreshMlsGroupMembers(gid).catch(() => {});
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: friendlyMessage(getInvokeErrorMessage(e, 'Could not restore access')),
    };
  }
}
