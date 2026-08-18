import { get } from 'svelte/store';
import { getMlsGroupMembers } from '../api/nostr';
import {
  getAnnouncementsChannel,
  loadMembersForParent,
} from '../parent-navbar';
import { getInvokeErrorMessage, friendlyMessage } from '../utils/tauri-errors';
import { sendSquadInviteDm } from '../pacto-app-inbox';
import { publishOutboundInviteAnnounce } from '../squad/squad-outbound-invite';
import { currentUser } from '../../stores/auth';
import type { Squad } from '../../stores/squads';
import type { SquadInvitePayload } from '../api/nostr';

export async function loadInviteCandidateNpubs(
  parent: Squad,
  dmNpubs: string[],
  currentUserNpub: string | undefined
): Promise<string[]> {
  const inParent = new Set(await loadMembersForParent(parent, currentUserNpub));
  const uniqueNpubs = [...new Set(dmNpubs)];
  return uniqueNpubs.filter((npub) => !inParent.has(npub) && npub !== currentUserNpub);
}

function newInviteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `inv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

    let admitterNpubs: string[] = [];
    try {
      const members = await getMlsGroupMembers(groupId);
      admitterNpubs = [...new Set([...(members.members ?? []), myNpub].filter(Boolean) as string[])];
    } catch {
      if (myNpub) admitterNpubs = [myNpub];
    }

    for (const npub of npubsToInvite) {
      const inviteId = newInviteId();
      try {
        await publishOutboundInviteAnnounce(parent, inviteId, npub);
      } catch (e) {
        console.warn('[invite-members] outbound announce failed', e);
      }

      const invitePayload: Omit<SquadInvitePayload, 'type'> = {
        squadName: parent.name,
        groupId,
        inviteId,
        admitterNpubs,
        kind: parent.kind === 'squad-pair' ? 'squad-pair' : 'squad',
        pairedSquads: parent.pairedSquads,
        iconUrl: parent.iconUrl,
      };

      try {
        await sendSquadInviteDm(npub, invitePayload, myNpub);
        invitedNpubs.push(npub);
      } catch (e) {
        console.warn('[invite-members] squad invite DM failed for', npub.slice(0, 20) + '…', e);
        lastErr = friendlyMessage(getInvokeErrorMessage(e));
      }
    }
    if (lastErr) onErrorBanner(lastErr);
    onComplete(invitedNpubs);
  })();
}
