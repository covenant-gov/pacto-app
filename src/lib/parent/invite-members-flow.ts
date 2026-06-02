import { get } from 'svelte/store';
import { inviteMemberToGroup } from '../api/nostr';
import {
  defaultParentInvitePhysicalGroupTargets,
  getAnnouncementsChannel,
  loadMembersForParent,
} from '../parent-navbar';
import { getInvokeErrorMessage, friendlyMessage } from '../utils/tauri-errors';
import { sendSquadInviteDm } from '../pacto-app-inbox';
import { currentUser } from '../../stores/auth';
import type { Squad } from '../../stores/squads';

export async function loadInviteCandidateNpubs(
  parent: Squad,
  dmNpubs: string[],
  currentUserNpub: string | undefined
): Promise<string[]> {
  const inParent = new Set(await loadMembersForParent(parent, currentUserNpub));
  const uniqueNpubs = [...new Set(dmNpubs)];
  return uniqueNpubs.filter((npub) => !inParent.has(npub));
}

/** MLS invites + squad invite DMs for each npub. */
export function runInviteMembersToParent(opts: {
  parent: Squad;
  npubsToInvite: string[];
  onErrorBanner: (message: string) => void;
  onComplete: () => void;
}): void {
  const { parent, npubsToInvite, onErrorBanner, onComplete } = opts;
  const announcementsChannel = getAnnouncementsChannel(parent);
  const inviteTargets = defaultParentInvitePhysicalGroupTargets(parent);
  const groupId = announcementsChannel.groupId;

  void (async () => {
    let lastErr = '';
    const myNpub = get(currentUser)?.npub;
    for (const npub of npubsToInvite) {
      for (const ch of inviteTargets) {
        try {
          await inviteMemberToGroup(ch.groupId, npub);
        } catch (e) {
          console.warn('[invite-members] MLS invite failed for', npub.slice(0, 20) + '…', e);
          lastErr = friendlyMessage(getInvokeErrorMessage(e));
        }
      }
      try {
        await sendSquadInviteDm(npub, { squadName: parent.name, groupId }, myNpub);
      } catch (e) {
        console.warn('[invite-members] squad invite DM failed for', npub.slice(0, 20) + '…', e);
        lastErr = friendlyMessage(getInvokeErrorMessage(e));
      }
    }
    if (lastErr) onErrorBanner(lastErr);
    onComplete();
  })();
}
