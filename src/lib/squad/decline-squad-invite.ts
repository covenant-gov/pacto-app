import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { parseSquadInviteMessage } from '../api/nostr';
import { declineWelcomeForGroup } from '../invites/pending-welcomes-store';
import { currentUser } from '../../stores/auth-session';
import { resolveOneCatchUpEntry } from '../../stores/catch-up';
import { declinedSquadInviteIds } from '../../stores/invite-decisions';
import { clearPendingSquadAdmissionByGroupId } from '../../stores/pending-squad-admission';
import { showToast } from '../../stores/toast';
import type { DmMessage } from '../../stores/dm';
import { publishInviteDeclinedClaims } from './squad-outbound-invite';

const declineInFlight = new Set<string>();

function commitLocalDecline(msg: DmMessage, groupId?: string): void {
  declinedSquadInviteIds.update((ids: string[]) => (ids.includes(msg.id) ? ids : [...ids, msg.id]));
  if (groupId) {
    declineWelcomeForGroup(groupId);
    clearPendingSquadAdmissionByGroupId(groupId);
  }
  resolveOneCatchUpEntry(msg.id).catch(() => {});
}

/**
 * Local decline plus DM claims so admitters can drop the squad-wide Pending row.
 * A consent-first card stays pending until at least one admitter DM is sent.
 */
export async function declineConsentFirstSquadInvite(msg: DmMessage): Promise<void> {
  if (declineInFlight.has(msg.id)) return;
  const declined = parseSquadInviteMessage(msg.content ?? '');
  if (!declined) {
    commitLocalDecline(msg);
    return;
  }
  const me = get(currentUser)?.npub?.trim();
  const inviteId = declined.inviteId?.trim();
  const admitters = [
    ...new Set(
      [...(declined.admitterNpubs ?? []), declined.invitedByNpub].filter(
        (n): n is string => typeof n === 'string' && n.startsWith('npub1'),
      ),
    ),
  ];
  if (!me || !inviteId || admitters.length === 0) {
    commitLocalDecline(msg, declined.groupId);
    return;
  }

  declineInFlight.add(msg.id);
  try {
    const delivered = await publishInviteDeclinedClaims({
      parentId: declined.groupId,
      inviteId,
      inviteeNpub: me,
      squadName: declined.squadName,
      admitterNpubs: admitters,
    });
    if (!delivered) {
      showToast(get(t)('messaging.inviteCard.declineFailed'), undefined, undefined, { error: true });
      return;
    }
    commitLocalDecline(msg, declined.groupId);
  } finally {
    declineInFlight.delete(msg.id);
  }
}
