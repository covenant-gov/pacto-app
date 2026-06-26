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
import {
  squads,
  type Channel,
  type Squad,
} from '../../stores/squads';
import {
  activeSquadId,
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

/** Optimistic channel row + background MLS create and channel-in-squad DMs. */
export function runCreateChannelInParent(opts: {
  parent: Squad;
  squadId: string;
  name: string;
  selectedNpubs: string[];
  onErrorBanner: (message: string) => void;
}): void {
  const { parent, squadId, name, selectedNpubs, onErrorBanner } = opts;
  const placeholderId = `creating-${Date.now()}`;
  const placeholderChannel: Channel = { name, groupId: placeholderId, order: parent.channels.length };

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
      const groupId = await createGroupChat(name, selectedNpubs);
      await persistSquadPatch(squadId, (s) => ({
        ...s,
        channels: s.channels.map((ch) =>
          ch.groupId === placeholderId ? { name, groupId, order: ch.order } : ch,
        ),
      }));
      if (get(activeChannelId) === placeholderId) {
        activeChannelId.set(groupId);
        activeHubChannelName.set(name);
      }
      const announcementsChannel = getAnnouncementsChannel(parent);
      const payload = formatChannelInSquadMessage({
        type: 'channel_in_squad',
        squadName: parent.name,
        announcementsGroupId: announcementsChannel.groupId,
        channelGroupId: groupId,
        channelName: name,
      });
      for (const npub of selectedNpubs) {
        try {
          await sendDmMessage(npub, payload);
        } catch (e) {
          console.warn('[create-channel] channel_in_squad DM failed for', npub.slice(0, 20) + '…', e);
        }
      }
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
