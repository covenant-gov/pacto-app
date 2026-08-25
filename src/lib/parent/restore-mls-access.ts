/**
 * Re-run MLS invite for a member who may already hold a leaf.
 * Backend `add_member_device` classifies that as Restore (remove-then-re-add).
 */

import { inviteMemberToGroup } from '../api/nostr';
import { bumpMembershipVersion } from '../../stores/mls-chat';
import { refreshMlsGroupMembers } from '../../stores/mls-group-members';
import { squads } from '../../stores/squads';
import { get } from 'svelte/store';
import { sendConsentFirstSquadInvite } from '../squad/consent-first-invite';
import { getInvokeErrorMessage, friendlyMessage } from '../utils/tauri-errors';

export type RestoreMlsAccessResult = { ok: true } | { ok: false; error: string };

export async function restoreMlsMemberAccess(
  groupId: string,
  memberNpub: string,
  isResend = false,
): Promise<RestoreMlsAccessResult> {
  const gid = groupId.trim();
  const npub = memberNpub.trim();
  if (!gid || !npub) {
    return { ok: false, error: 'Missing group or member.' };
  }
  try {
    await inviteMemberToGroup(gid, npub, isResend);
    bumpMembershipVersion(gid);
    await refreshMlsGroupMembers(gid).catch(() => {});
    if (isResend) {
      const squad = get(squads).find((s) => s.id === gid);
      if (squad) {
        const result = await sendConsentFirstSquadInvite(squad, npub);
        if (!result.ok) {
          console.warn(
            '[mls] consent-first invite after resend failed for',
            npub.slice(0, 20) + '…',
            result.error,
          );
        }
      }
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: friendlyMessage(getInvokeErrorMessage(e, 'Could not restore access')),
    };
  }
}
