import { get } from 'svelte/store';
import { parseSquadInviteMessage } from '../api/nostr';
import { declineWelcomeForGroup } from '../invites/pending-welcomes-store';
import { currentUser } from '../../stores/auth-session';
import { resolveOneCatchUpEntry } from '../../stores/catch-up';
import { declinedSquadInviteIds } from '../../stores/invite-decisions';
import { clearPendingSquadAdmissionByGroupId } from '../../stores/pending-squad-admission';
import type { DmMessage } from '../../stores/dm';
import { publishInviteDeclinedClaims } from './squad-outbound-invite';

/** Local decline plus DM claims so admitters can drop the squad-wide Pending row. */
export async function declineConsentFirstSquadInvite(msg: DmMessage): Promise<void> {
  declinedSquadInviteIds.update((ids: string[]) => (ids.includes(msg.id) ? ids : [...ids, msg.id]));
  resolveOneCatchUpEntry(msg.id).catch(() => {});
  const declined = parseSquadInviteMessage(msg.content ?? '');
  if (!declined) return;
  declineWelcomeForGroup(declined.groupId);
  clearPendingSquadAdmissionByGroupId(declined.groupId);
  const me = get(currentUser)?.npub?.trim();
  const inviteId = declined.inviteId?.trim();
  const admitters = [
    ...new Set(
      [...(declined.admitterNpubs ?? []), declined.invitedByNpub].filter(
        (n): n is string => typeof n === 'string' && n.startsWith('npub1'),
      ),
    ),
  ];
  if (!me || !inviteId || admitters.length === 0) return;
  await publishInviteDeclinedClaims({
    parentId: declined.groupId,
    inviteId,
    inviteeNpub: me,
    squadName: declined.squadName,
    admitterNpubs: admitters,
  });
}
