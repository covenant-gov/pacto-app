/** Squad-pair creation helpers — see ai-docs/networks/RNF_PLAN.md */

import { get } from 'svelte/store';
import { createDefaultParentChannels, getAnnouncementsChannel } from './parent-navbar';
import { getInvokeErrorMessage, friendlyMessage } from './utils/tauri-errors';
import { sendSquadInviteDm } from './pacto-app-inbox';
import { activateSquadHub } from './squad-hub-nav';
import { currentUser } from '../stores/auth';
import {
  squads,
  addParentCreatingAnnouncements,
  removeParentCreatingAnnouncements,
  parentCreateErrorById,
  parentPendingCreateMembers,
  ANNOUNCEMENTS_CHANNEL_NAME,
  type Squad,
} from '../stores/squads';
import {
  activeSquadId,
  activeChannelId,
  activeHubChannelName,
  activeView,
  activeTopNavTab,
  lastChannelBySquadId,
  lastHubChannelNameBySquadId,
} from '../stores/navigation';
import { pendingReadyToast } from '../stores/toast';
import { schedulePublicSquadCreateBroadcast } from './commons/squad-create-broadcast';
import { persistCreatedSquad } from './squad/squad-catalog';
import { initSquadBot } from './squad/squad-bot';
import type { PairedSquads } from './squad-pair';

function resolvePublicSquadBroadcastTarget(squadId: string) {
  const squad = get(squads).find((s) => s.id === squadId);
  if (!squad) return undefined;
  return {
    id: squad.id,
    name: squad.name,
    kind: squad.kind,
    iconUrl: squad.iconUrl,
    visibility: squad.visibility,
    commonsTags: squad.commonsTags,
  };
}

export interface SquadPairAnchorRef {
  id: string;
  name: string;
}

/** Regular squad used when creating a pair from the active hub. */
export function resolvePairAnchorFromHub(hub: Squad, allSquads: Squad[]): Squad | undefined {
  if (hub.kind !== 'squad-pair') {
    return (hub.channels?.length ?? 0) > 0 ? hub : undefined;
  }
  for (const ref of hub.pairedSquads ?? []) {
    const squad = allSquads.find((s) => s.id === ref.id);
    if (squad && squad.kind !== 'squad-pair' && (squad.channels?.length ?? 0) > 0) {
      return squad;
    }
  }
  return undefined;
}

/** Ids to exclude from the partner picker (other anchors when pairing from a squad-pair hub). */
export function pairPartnerExcludeSquadIds(hub: Squad, anchor: Squad): string[] {
  if (hub.kind !== 'squad-pair') return [];
  return (hub.pairedSquads ?? []).map((p) => p.id).filter((id) => id !== anchor.id);
}

/** Regular squads the user can pair with (excludes anchor, optional extra ids, and squad-pairs). */
export function partnerSquadCandidates(
  allSquads: Squad[],
  anchorSquadId: string,
  alsoExcludeSquadIds: string[] = []
): Squad[] {
  const excluded = new Set([anchorSquadId, ...alsoExcludeSquadIds]);
  return allSquads.filter(
    (s) =>
      !excluded.has(s.id) &&
      s.kind !== 'squad-pair' &&
      (s.channels?.length ?? 0) > 0
  );
}

export function buildPairedSquads(anchor: SquadPairAnchorRef, partner: SquadPairAnchorRef): PairedSquads {
  return [
    { id: anchor.id, name: anchor.name },
    { id: partner.id, name: partner.name },
  ];
}

type MlsMembersResult = { members?: string[] };

/** Union of MLS members from two squads' announcements groups, excluding the current user. */
export async function collectInviteNpubsForSquads(
  squadList: Squad[],
  excludeNpub: string | undefined,
  fetchMembers: (announcementsGroupId: string) => Promise<MlsMembersResult>
): Promise<string[]> {
  const allNpubs = new Set<string>();
  for (const squad of squadList) {
    const ann = getAnnouncementsChannel(squad);
    if (!ann?.groupId?.trim() || ann.groupId.startsWith('creating-')) {
      throw new Error(`Squad "${squad.name}" has no announcements channel`);
    }
    const result = await fetchMembers(ann.groupId);
    for (const npub of result.members ?? []) {
      if (npub !== excludeNpub) allNpubs.add(npub);
    }
  }
  return [...allNpubs];
}

export interface SquadPairCreateCommons {
  visibility: 'private' | 'public';
  commonsTags?: string[];
}

/** Optimistic squad-pair row + background announcements MLS create and invite DMs. */
export function runSquadPairCreateFlow(
  name: string,
  memberNpubs: string[],
  anchor: Squad,
  partner: Squad,
  iconUrl?: string,
  commons: SquadPairCreateCommons = { visibility: 'private' }
): void {
  const pairedSquads = buildPairedSquads(anchor, partner);
  const visibility = commons.visibility === 'public' ? 'public' : 'private';
  const now = Date.now();
  const tempId = 'creating-squad-pair-' + now;
  const squadPair: Squad = {
    id: tempId,
    name,
    iconUrl,
    channels: [],
    kind: 'squad-pair',
    pairedSquads,
    visibility,
    commonsTags: visibility === 'public' ? commons.commonsTags : undefined,
    createdAt: now,
    updatedAt: now,
  };
  addParentCreatingAnnouncements(squadPair.id);
  parentPendingCreateMembers.update((m) => ({ ...m, [squadPair.id]: memberNpubs }));
  squads.update((list) => [...list, squadPair]);
  activeSquadId.set(tempId);
  activeChannelId.set(null);
  activeHubChannelName.set(null);
  activeView.set('hub');
  activeTopNavTab.set('squads');

  void (async () => {
    try {
      const { parentId, channels } = await createDefaultParentChannels(memberNpubs);
      const groupId = parentId;
      const paired = buildPairedSquads(anchor, partner);
      const finalized: Squad = {
        id: groupId,
        name,
        iconUrl,
        channels,
        kind: 'squad-pair',
        pairedSquads: paired,
        visibility,
        commonsTags: visibility === 'public' ? commons.commonsTags : undefined,
        createdAt: squadPair.createdAt,
        updatedAt: Date.now(),
      };
      await persistCreatedSquad(tempId, finalized);
      void initSquadBot(groupId);
      removeParentCreatingAnnouncements(tempId);
      parentCreateErrorById.update((m) => {
        const next = { ...m };
        delete next[tempId];
        return next;
      });
      parentPendingCreateMembers.update((m) => {
        const next = { ...m };
        delete next[tempId];
        return next;
      });
      activateSquadHub(groupId);
      pendingReadyToast.set({
        text: `${name} is ready!`,
        goTo: {
          type: 'squad',
          name,
          id: groupId,
          channelId: groupId,
          hubChannelName:
            channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name,
        },
      });
      const myNpub = get(currentUser)?.npub;
      for (const npub of memberNpubs) {
        try {
          await sendSquadInviteDm(
            npub,
            { squadName: name, groupId, kind: 'squad-pair', pairedSquads: paired },
            myNpub
          );
        } catch (e) {
          console.warn('[squad-pair-create] invite DM failed for', npub.slice(0, 20) + '…', e);
        }
      }
      schedulePublicSquadCreateBroadcast(groupId, () => resolvePublicSquadBroadcastTarget(groupId));
    } catch (e) {
      removeParentCreatingAnnouncements(tempId);
      parentCreateErrorById.update((m) => ({
        ...m,
        [tempId]: friendlyMessage(
          getInvokeErrorMessage(e, 'Failed to create partner squad announcements channel')
        ),
      }));
      squads.update((list) => list.filter((s) => s.id !== tempId));
      if (get(activeSquadId) === tempId) {
        activeSquadId.set(anchor.id);
        activeChannelId.set(null);
        activeHubChannelName.set(null);
      }
    }
  })();
}

/** Retry failed announcements channel create for a squad still in `creating` state. */
export async function retryParentAnnouncementsCreate(parent: Squad): Promise<void> {
  const memberIds = get(parentPendingCreateMembers)[parent.id];
  if (!memberIds?.length) return;

  const { parentId: gid, channels } = await createDefaultParentChannels(memberIds);
  const finalized: Squad = {
    ...parent,
    id: gid,
    channels,
    updatedAt: Date.now(),
  };
  await persistCreatedSquad(parent.id, finalized);
  void initSquadBot(gid);
  if (get(activeSquadId) === parent.id) {
    activeSquadId.set(gid);
    activeChannelId.set(gid);
    const hub =
      channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name ?? null;
    activeHubChannelName.set(hub);
  }
  lastChannelBySquadId.update((m) => {
    const next = { ...m };
    delete next[parent.id];
    return { ...next, [gid]: gid };
  });
  lastHubChannelNameBySquadId.update((m) => {
    const next = { ...m };
    delete next[parent.id];
    const hubName =
      channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name ?? '';
    return hubName ? { ...next, [gid]: hubName } : next;
  });
  pendingReadyToast.set({
    text: `${parent.name} is ready!`,
    goTo: {
      type: 'squad',
      name: parent.name,
      id: gid,
      channelId: gid,
      hubChannelName:
        channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name,
    },
  });
  removeParentCreatingAnnouncements(parent.id);
  parentCreateErrorById.update((m) => {
    const next = { ...m };
    delete next[parent.id];
    return next;
  });
  parentPendingCreateMembers.update((m) => {
    const next = { ...m };
    delete next[parent.id];
    return next;
  });
  const myNpub = get(currentUser)?.npub;
  for (const npub of memberIds) {
    try {
      await sendSquadInviteDm(npub, { squadName: parent.name, groupId: gid }, myNpub);
    } catch (e) {
      console.warn('[squad-pair-create] retry invite DM failed for', npub.slice(0, 20) + '…', e);
    }
  }
  schedulePublicSquadCreateBroadcast(gid, () => resolvePublicSquadBroadcastTarget(gid));
}
