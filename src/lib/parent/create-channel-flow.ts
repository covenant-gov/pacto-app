import { get } from 'svelte/store';
import {
  createGroupChat,
  formatChannelInSquadMessage,
  sendDmMessage,
} from '../api/nostr';
import { getAnnouncementsChannel, loadMembersForParent } from '../parent-navbar';
import { resolveHubChannelNameForGroupSelection } from '../mls/virtual-channel-bucket';
import { getInvokeErrorMessage, friendlyMessage } from '../utils/tauri-errors';
import { persistSquadPatch } from '../squad/squad-catalog';
import { publishSquadChannelsCatalog } from '../squad/squad-channels-catalog';
import { warnSkippedMembers, skippedMembersNotice, warnPendingInvites, pendingInvitesNotice } from '../squad/skipped-members';
import { showToast } from '../../stores/toast';
import type { ChannelAccess } from './channel-access';
import {
  squads,
  type Channel,
  type Squad,
} from '../../stores/squads';
import {
  activeChannelId,
  activeHubChannelName,
  activeView,
  lastChannelBySquadId,
  lastHubChannelNameBySquadId,
} from '../../stores/navigation';

export async function loadCreateChannelMemberList(
  parent: Squad,
  currentUserNpub: string | undefined,
): Promise<string[]> {
  return loadMembersForParent(parent, currentUserNpub);
}

/** Optimistic channel row + background MLS create; under-the-hood welcomes for members. */
export function runCreateChannelInParent(opts: {
  parent: Squad;
  squadId: string;
  name: string;
  selectedNpubs: string[];
  access: ChannelAccess;
  onErrorBanner: (message: string) => void;
}): void {
  const { parent, squadId, name, selectedNpubs, access, onErrorBanner } = opts;
  const placeholderId = `creating-${Date.now()}`;
  const placeholderChannel: Channel = {
    name,
    groupId: placeholderId,
    order: parent.channels.length,
    access,
  };

  squads.update((list) =>
    list.map((s) => (s.id !== squadId ? s : { ...s, channels: [...s.channels, placeholderChannel] })),
  );
  activeChannelId.set(placeholderId);
  activeHubChannelName.set(name);
  activeView.set('hub');
  lastChannelBySquadId.update((m) => ({ ...m, [squadId]: placeholderId }));
  lastHubChannelNameBySquadId.update((m) => ({ ...m, [squadId]: name }));

  void (async () => {
    try {
      const { groupId, skippedMembers, pendingInvites } = await createGroupChat(name, selectedNpubs);
      await persistSquadPatch(squadId, (s) => ({
        ...s,
        channels: s.channels.map((ch) =>
          ch.groupId === placeholderId
            ? { name, groupId, order: ch.order, access }
            : ch,
        ),
      }));
      if (get(activeChannelId) === placeholderId) {
        activeChannelId.set(groupId);
        activeHubChannelName.set(name);
      }

      const live = get(squads).find((s) => s.id === squadId);
      if (live && access === 'open') {
        void publishSquadChannelsCatalog(live);
      }

      // Under-the-hood notify for auto-accept + catalog attach (backend suppresses invite card when in squad).
      const announcementsChannel = getAnnouncementsChannel(parent);
      const payload = formatChannelInSquadMessage({
        type: 'channel_in_squad',
        squadName: parent.name,
        announcementsGroupId: announcementsChannel.groupId,
        channelGroupId: groupId,
        channelName: name,
      });
      const skippedNpubs = new Set(skippedMembers.map((s) => s.npub));
      for (const npub of selectedNpubs) {
        if (skippedNpubs.has(npub)) continue;
        try {
          await sendDmMessage(npub, payload);
        } catch (e) {
          console.warn('[create-channel] channel notify failed for', npub.slice(0, 20) + '…', e);
        }
      }
      if (skippedMembers.length > 0) warnSkippedMembers(skippedMembers);
      if (pendingInvites.length > 0) warnPendingInvites(pendingInvites);
      const readyNotice = [skippedMembersNotice(skippedMembers), pendingInvitesNotice(pendingInvites)]
        .filter(Boolean)
        .join(' ');
      if (readyNotice) showToast(readyNotice);
    } catch (e) {
      onErrorBanner(friendlyMessage(getInvokeErrorMessage(e)));
      await persistSquadPatch(squadId, (s) => ({
        ...s,
        channels: s.channels.filter((ch) => ch.groupId !== placeholderId),
      }));
      if (get(activeChannelId) === placeholderId) {
        const still = get(squads).find((s) => s.id === squadId);
        const sorted = still?.channels.slice().sort((a, b) => a.order - b.order) ?? [];
        const gid = sorted[0]?.groupId ?? null;
        activeChannelId.set(gid);
        activeHubChannelName.set(
          gid ? resolveHubChannelNameForGroupSelection(sorted, gid, null) : null,
        );
      }
    }
  })();
}
