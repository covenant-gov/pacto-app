import { get } from 'svelte/store';
import {
  getAnnouncementsChannel,
  loadMembersForParent,
} from '../parent-navbar';
import {
  resolveAdmitterNpubs,
  sendConsentFirstSquadInvite,
} from '../squad/consent-first-invite';
import { currentUser } from '../../stores/auth';
import type { Squad } from '../../stores/squads';

export async function loadInviteCandidateNpubs(
  parent: Squad,
  dmNpubs: string[],
  currentUserNpub: string | undefined
): Promise<string[]> {
  const inParent = new Set(await loadMembersForParent(parent, currentUserNpub));
  const uniqueNpubs = [...new Set(dmNpubs)];
  return uniqueNpubs.filter((npub) => !inParent.has(npub) && npub !== currentUserNpub);
}

/**
 * Outbound squad invite only: inbox card + pending announce.
 * Does not MLS-add until the invitee Accepts (admit pipeline).
 */
export function runInviteMembersToParent(opts: {
  parent: Squad;
  npubsToInvite: string[];
  onErrorBanner: (message: string) => void;
  onComplete: (invitedNpubs: string[]) => void;
}): void {
  const { parent, npubsToInvite, onErrorBanner, onComplete } = opts;
  const announcementsChannel = getAnnouncementsChannel(parent);
  const groupId = announcementsChannel.groupId?.trim();

  void (async () => {
    let lastErr = '';
    const invitedNpubs: string[] = [];
    const myNpub = get(currentUser)?.npub;
    if (!groupId) {
      onErrorBanner('Squad channels are not ready to send invites yet.');
      onComplete(invitedNpubs);
      return;
    }

    const admitterNpubs = await resolveAdmitterNpubs(groupId, myNpub);

    for (const npub of npubsToInvite) {
      const result = await sendConsentFirstSquadInvite(parent, npub, { admitterNpubs });
      if (result.ok) {
        invitedNpubs.push(npub);
      } else {
        lastErr = result.error;
      }
    }
    if (lastErr) onErrorBanner(lastErr);
    onComplete(invitedNpubs);
  })();
}
