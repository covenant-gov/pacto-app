import {
  formatChannelInSquadMessage,
  inviteMemberToGroup,
  sendDmMessage,
} from '../api/nostr';
import { bumpMembershipVersion } from '../../stores/mls-chat';
import { getInvokeErrorMessage, friendlyMessage } from '../utils/tauri-errors';

export interface SquadChannelInviteContext {
  squadName: string;
  announcementsGroupId: string;
  channelName: string;
}

/** MLS invite + under-the-hood notify (no invite card when already in squad). */
export function runInviteMemberToChannel(opts: {
  groupId: string;
  memberNpub: string;
  squad?: SquadChannelInviteContext | null;
  onError: (message: string) => void;
}): void {
  const { groupId, memberNpub, squad, onError } = opts;
  void (async () => {
    try {
      await inviteMemberToGroup(groupId, memberNpub);
      bumpMembershipVersion(groupId);
    } catch (e) {
      onError(friendlyMessage(getInvokeErrorMessage(e, 'Failed to invite')));
      return;
    }

    if (!squad) return;

    try {
      const payload = formatChannelInSquadMessage({
        type: 'channel_in_squad',
        squadName: squad.squadName,
        announcementsGroupId: squad.announcementsGroupId,
        channelGroupId: groupId,
        channelName: squad.channelName,
      });
      await sendDmMessage(memberNpub, payload);
    } catch (e) {
      console.warn('[invite-channel] channel notify failed for', memberNpub.slice(0, 20) + '…', e);
      onError(
        friendlyMessage(
          getInvokeErrorMessage(
            e,
            'Added to the channel, but the join notification could not be sent. Ask them to use Request sync.',
          ),
        ),
      );
    }
  })();
}
