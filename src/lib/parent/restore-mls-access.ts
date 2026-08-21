/**
 * Re-run MLS invite for a member who may already hold a leaf.
 * Backend `add_member_device` classifies that as Restore (remove-then-re-add).
 */

import { get } from 'svelte/store';
import { inviteMemberToGroup } from '../api/nostr';
import { sendSquadInviteDm } from '../pacto-app-inbox';
import { bumpMembershipVersion } from '../../stores/mls-chat';
import { refreshMlsGroupMembers } from '../../stores/mls-group-members';
import { currentUser } from '../../stores/auth';
import { squads } from '../../stores/squads';
import { getInvokeErrorMessage, friendlyMessage } from '../utils/tauri-errors';

export type RestoreMlsAccessResult = { ok: true } | { ok: false; error: string };

async function sendSquadInviteDmAfterResend(groupId: string, memberNpub: string): Promise<void> {
  const squad = get(squads).find((s) => s.id === groupId);
  if (!squad) return;
  await sendSquadInviteDm(
    memberNpub,
    {
      squadName: squad.name,
      groupId: squad.id,
      kind: squad.kind,
      pairedSquads: squad.pairedSquads,
      iconUrl: squad.iconUrl,
    },
    get(currentUser)?.npub,
  );
}

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
      try {
        await sendSquadInviteDmAfterResend(gid, npub);
      } catch (e) {
        console.warn('[mls] squad invite DM after resend failed for', npub.slice(0, 20) + '…', e);
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
