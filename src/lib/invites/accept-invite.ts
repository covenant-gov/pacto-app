import { get, writable } from 'svelte/store';
import {
  listPendingMlsWelcomes,
  acceptMlsWelcome,
  parseSquadInviteMessage,
  syncMlsGroupsNow,
  getMlsGroupMembers,
  backfillSquadMemberEvmFromProfiles,
} from '../api/nostr';
import { defaultChannelRowsForGroupId } from '../parent-navbar';
import { normalizeStoredSquad } from '../squad-pair';
import { persistSquad, persistSquadPatch } from '../squad/squad-catalog';
import { dmError } from '../utils/dm-debug';
import {
  squads,
  activeSquadId,
  activeChannelId,
  activeHubChannelName,
  activeTopNavTab,
  activeView,
  acceptedSquadInviteIds,
  acceptedChannelInviteMessageIds,
  bumpMembershipVersion,
  ANNOUNCEMENTS_CHANNEL_NAME,
  type DmMessage,
  type Squad,
} from '../../stores/app';
import { pendingReadyToast } from '../../stores/toast';

/** Group IDs we just accepted — skip unattributed "Add to squad" modal for these. */
const acceptedSquadInviteGroupIds = new Set<string>();

/** Maps channel group id → parent squad while welcome accept is in flight. */
const channelInvitePendingAccept = new Map<string, { parentId: string; channelName: string }>();

export const acceptingSquadInviteId = writable<string | null>(null);
export const acceptingChannelInSquadId = writable<string | null>(null);

export function resetInviteAcceptState(): void {
  acceptedSquadInviteGroupIds.clear();
  channelInvitePendingAccept.clear();
  acceptingSquadInviteId.set(null);
  acceptingChannelInSquadId.set(null);
}

function addChannelToParent(parentId: string, channelGroupId: string, channelName: string): void {
  void persistSquadPatch(parentId, (squad) => {
    if (squad.channels.some((ch) => ch.groupId === channelGroupId)) return squad;
    return {
      ...squad,
      channels: [
        ...squad.channels,
        { name: channelName, groupId: channelGroupId, order: squad.channels.length },
      ],
    };
  });
}

export interface AnnouncementsInvitePayload {
  groupId: string;
  name: string;
  memberSquads?: { id: string; name: string }[];
}

export async function acceptAnnouncementsInvite(
  payload: AnnouncementsInvitePayload,
  messageId: string
): Promise<void> {
  const welcomes = await listPendingMlsWelcomes();
  const welcome = welcomes.find((w) => w.nostr_group_id === payload.groupId);
  if (!welcome) {
    const err = new Error('No pending welcome') as Error & { noWelcome?: boolean };
    err.noWelcome = true;
    throw err;
  }
  acceptedSquadInviteGroupIds.add(payload.groupId);
  await acceptMlsWelcome(welcome.id);
  const now = Date.now();
  const defaultChannels = defaultChannelRowsForGroupId(payload.groupId);
  const isSquadPair = (payload.memberSquads?.length ?? 0) > 0;
  const newSquad: Squad = isSquadPair
    ? (normalizeStoredSquad({
        id: payload.groupId,
        name: payload.name,
        channels: defaultChannels,
        kind: 'squad-pair',
        pairedSquads: payload.memberSquads,
        createdAt: now,
        updatedAt: now,
      }) as Squad)
    : {
        id: payload.groupId,
        name: payload.name,
        channels: defaultChannels,
        kind: 'squad',
        createdAt: now,
        updatedAt: now,
      };
  squads.update((list: Squad[]) =>
    isSquadPair
      ? [...list.filter((s) => s.id !== newSquad.id), newSquad]
      : [...list, newSquad]
  );
  try {
    await persistSquad(newSquad);
  } catch (e) {
    dmError('persistSquad after accept invite', e);
    squads.update((list: Squad[]) => list.filter((s) => s.id !== newSquad.id));
    throw e;
  }
  activeSquadId.set(newSquad.id);
  activeChannelId.set(payload.groupId);
  activeHubChannelName.set(ANNOUNCEMENTS_CHANNEL_NAME);
  activeTopNavTab.set('squads');
  activeView.set('hub');
  acceptedSquadInviteIds.update((ids: string[]) =>
    ids.includes(messageId) ? ids : [...ids, messageId]
  );
  try {
    await syncMlsGroupsNow(payload.groupId);
  } catch (e) {
    dmError('syncMlsGroupsNow after accept invite', e);
  }
  try {
    const membersResult = await getMlsGroupMembers(payload.groupId);
    const memberNpubs = (membersResult.members ?? []) as string[];
    await backfillSquadMemberEvmFromProfiles(payload.groupId, memberNpubs);
  } catch (e) {
    dmError('backfillSquadMemberEvmFromProfiles after accept', e);
  }
  bumpMembershipVersion(payload.groupId);
  pendingReadyToast.set({
    text: `${payload.name} is ready!`,
    goTo: {
      type: 'squad',
      name: payload.name,
      id: payload.groupId,
      channelId: payload.groupId,
    },
  });
}

export async function acceptSquadOrPairInvite(msg: DmMessage): Promise<void> {
  const payload = parseSquadInviteMessage(msg.content);
  if (!payload) return;
  if (get(acceptingSquadInviteId)) return;
  acceptingSquadInviteId.set(msg.id);
  try {
    await acceptAnnouncementsInvite(
      {
        groupId: payload.groupId,
        name: payload.squadName,
        memberSquads:
          payload.kind === 'squad-pair' && payload.pairedSquads
            ? [...payload.pairedSquads]
            : undefined,
      },
      msg.id
    );
  } catch (e) {
    dmError('Accept squad invite failed', e);
  } finally {
    acceptingSquadInviteId.set(null);
  }
}

export interface ChannelInSquadInvitePayload {
  channelGroupId: string;
  announcementsGroupId: string;
  channelName: string;
}

export async function acceptChannelInSquadInvite(
  msg: DmMessage,
  payload: ChannelInSquadInvitePayload
): Promise<void> {
  if (get(acceptingChannelInSquadId)) return;
  acceptingChannelInSquadId.set(msg.id);
  try {
    const welcomes = await listPendingMlsWelcomes();
    const welcome = welcomes.find((w) => w.nostr_group_id === payload.channelGroupId);
    if (!welcome) {
      dmError('Accept channel in squad: no pending welcome for channel', payload.channelGroupId);
      return;
    }
    channelInvitePendingAccept.set(payload.channelGroupId, {
      parentId: payload.announcementsGroupId,
      channelName: payload.channelName,
    });
    acceptedSquadInviteGroupIds.add(payload.channelGroupId);
    await acceptMlsWelcome(welcome.id);
    acceptedChannelInviteMessageIds.update((ids: string[]) =>
      ids.includes(msg.id) ? ids : [...ids, msg.id]
    );
  } catch (e) {
    dmError('Accept channel invite failed', e);
    channelInvitePendingAccept.delete(payload.channelGroupId);
    acceptedSquadInviteGroupIds.delete(payload.channelGroupId);
  } finally {
    acceptingChannelInSquadId.set(null);
  }
}

/** After backend confirms MLS welcome accept — attach channel or ignore unattributed welcomes. */
export function handleMlsWelcomeAccepted(group_id: string): void {
  const channelInviteInfo = channelInvitePendingAccept.get(group_id);
  if (channelInviteInfo) {
    channelInvitePendingAccept.delete(group_id);
    acceptedSquadInviteGroupIds.delete(group_id);
    addChannelToParent(channelInviteInfo.parentId, group_id, channelInviteInfo.channelName);
    return;
  }
  if (acceptedSquadInviteGroupIds.has(group_id)) {
    acceptedSquadInviteGroupIds.delete(group_id);
    return;
  }
  const list = get(squads);
  const singleChannelSquads = list.filter((s: Squad) => s.channels.length === 1);
  if (singleChannelSquads.length === 1) {
    const squad = singleChannelSquads[0];
    const name = group_id.slice(0, 12) + '…';
    void persistSquadPatch(squad.id, (s) => {
      if (s.channels.some((ch) => ch.groupId === group_id)) return s;
      return {
        ...s,
        channels: [...s.channels, { name, groupId: group_id, order: s.channels.length }],
      };
    });
  }
}

export function handleChannelAddedToSquad(
  announcements_group_id: string,
  channel_group_id: string,
  channel_name: string
): void {
  addChannelToParent(announcements_group_id, channel_group_id, channel_name);
}
