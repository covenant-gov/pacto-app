import {
  formatChannelInSquadMessage,
  inviteMemberToGroup,
  sendDmMessage,
} from '../api/nostr';
import { bumpMembershipVersion } from '../../stores/mls-chat';
import { getInvokeErrorMessage, friendlyMessage } from '../utils/tauri-errors';
import {
  requireMySquadPrivilege,
  squadPrivilegeDeniedMessage,
} from '../governance/squad-privilege-enforce';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

export interface SquadChannelInviteContext {
  parentId: string;
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
      const parentId = squad?.parentId.trim() ?? '';
      if (squad) {
        if (!parentId) {
          onError(get(t)('squad.access.inviteFailed'));
          return;
        }
        const priv = await requireMySquadPrivilege(parentId, 'inviteAccept');
        if (!priv.ok) {
          onError(squadPrivilegeDeniedMessage(priv, get(t)));
          return;
        }
      }
      await inviteMemberToGroup(groupId, memberNpub, false, squad ? parentId : null);
      bumpMembershipVersion(groupId);
    } catch (e) {
      onError(friendlyMessage(getInvokeErrorMessage(e, get(t)('squad.access.inviteFailed'))));
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
            get(t)('squad.access.joinNotificationFailed'),
          ),
        ),
      );
    }
  })();
}
