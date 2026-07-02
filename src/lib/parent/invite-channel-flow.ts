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

/** MLS invite + channel-in-squad DM so invitees get the channel in their sidebar. */
export function runInviteMemberToChannel(opts: {
  groupId: string;
  memberNpub: string;
  squad?: SquadChannelInviteContext | null;
  onError: (message: string) => void;
}): void {
  const { groupId, memberNpub, squad, onError } = opts;
  void (async () => {
    let mlsOk = false;
    try {
      await inviteMemberToGroup(groupId, memberNpub);
      bumpMembershipVersion(groupId);
      mlsOk = true;
    } catch (e) {
      const msg = friendlyMessage(getInvokeErrorMessage(e, 'Failed to invite'));
      if (!squad) {
        onError(msg);
        return;
      }
      console.warn('[invite-channel] MLS invite failed; sending channel_in_squad DM anyway', msg);
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
      console.warn('[invite-channel] channel_in_squad DM failed for', memberNpub.slice(0, 20) + '…', e);
      const dmMsg = friendlyMessage(
        getInvokeErrorMessage(
          e,
          'The channel invite notification could not be sent. They may not see the channel until you retry.',
        ),
      );
      onError(mlsOk ? dmMsg : `Could not add them to the channel or send the invite notification. ${dmMsg}`);
    }
  })();
}
