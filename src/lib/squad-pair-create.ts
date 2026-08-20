/** Squad-pair creation helpers — see ai-docs/networks/RNF_PLAN.md */

import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
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
  parentPendingCreateOptions,
  parentRetryingCreateIds,
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
  squadNavOrder,
} from '../stores/navigation';
import { pendingReadyToast, showToast } from '../stores/toast';
import { schedulePublicSquadCreateBroadcast } from './commons/squad-create-broadcast';
import { persistCreatedSquad } from './squad/squad-catalog';
import { appendSquadNavId } from './squad/squad-nav-order';
import { initSquadBot } from './squad/squad-bot';
import { applySquadCreateNetwork } from './squad/squad-create-network';
import { warnSkippedMembers, skippedMembersNotice, warnPendingInvites, pendingInvitesNotice } from './squad/skipped-members';
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

/**
 * Show the create-failure toast with a Retry action that re-arms itself on repeat failure.
 * Shared by every create surface so a second failure is never an unhandled rejection.
 */
export function showCreateFailureToast(squadPair: Squad, message: string): void {
  showToast(
    message,
    undefined,
    {
      label: get(t)('governance.common.retry'),
      action: () => {
        void retryParentAnnouncementsCreate(squadPair).catch((e) => {
          const retryMessage = friendlyMessage(
            getInvokeErrorMessage(e, get(t)('nav.navbar.organizeSquad.createAnnouncementsError'))
          );
          parentCreateErrorById.update((m) => ({ ...m, [squadPair.id]: retryMessage }));
          showCreateFailureToast(squadPair, retryMessage);
        });
      },
    },
    { error: true }
  );
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
  squadNavOrder.update((order) => appendSquadNavId(order, squadPair.id));
  activeSquadId.set(tempId);
  activeChannelId.set(null);
  activeHubChannelName.set(null);
  activeView.set('hub');
  activeTopNavTab.set('squads');

  void (async () => {
    try {
      const { parentId, channels, skippedMembers, pendingInvites } = await createDefaultParentChannels(memberNpubs);
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
      const skippedNotice = skippedMembersNotice(skippedMembers);
      const pendingNotice = pendingInvitesNotice(pendingInvites);
      if (skippedMembers.length > 0) warnSkippedMembers(skippedMembers);
      if (pendingInvites.length > 0) warnPendingInvites(pendingInvites);
      const readyNotice = [skippedNotice, pendingNotice].filter(Boolean).join(' ');
      pendingReadyToast.set({
        text: readyNotice || get(t)('nav.navbar.organizeSquad.squadReady', { values: { squadName: name } }),
        goTo: {
          type: 'squad',
          name,
          id: groupId,
          channelId: groupId,
          hubChannelName:
            channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name,
        },
      });
      const skippedNpubs = new Set(skippedMembers.map((s) => s.npub));
      const myNpub = get(currentUser)?.npub;
      for (const npub of memberNpubs) {
        if (skippedNpubs.has(npub)) continue;
        try {
          await sendSquadInviteDm(
            npub,
            { squadName: name, groupId, kind: 'squad-pair', pairedSquads: paired, iconUrl },
            myNpub
          );
        } catch (e) {
          console.warn('[squad-pair-create] invite DM failed for', npub.slice(0, 20) + '…', e);
        }
      }
      schedulePublicSquadCreateBroadcast(groupId, () => resolvePublicSquadBroadcastTarget(groupId));
    } catch (e) {
      const message = friendlyMessage(
        getInvokeErrorMessage(e, get(t)('nav.navbar.organizeSquad.createAnnouncementsError'))
      );
      parentCreateErrorById.update((m) => ({ ...m, [tempId]: message }));
      showCreateFailureToast(squadPair, message);
    }
  })();
}

/**
 * Retry failed announcements channel create for a squad still in `creating` state.
 * Re-entrant calls for the same parent are dropped: a second create would mint a second MLS
 * group, a duplicate squad row, and a second round of invite DMs.
 */
export async function retryParentAnnouncementsCreate(parent: Squad): Promise<void> {
  const memberIds = get(parentPendingCreateMembers)[parent.id];
  if (!memberIds?.length) return;
  if (get(parentRetryingCreateIds).has(parent.id)) return;
  parentRetryingCreateIds.update((s) => new Set(s).add(parent.id));
  try {
    await finalizeParentAnnouncementsCreate(parent, memberIds);
  } finally {
    parentRetryingCreateIds.update((s) => {
      const next = new Set(s);
      next.delete(parent.id);
      return next;
    });
  }
}

async function finalizeParentAnnouncementsCreate(parent: Squad, memberIds: string[]): Promise<void> {
  const { parentId: gid, channels, skippedMembers, pendingInvites } = await createDefaultParentChannels(memberIds);

  // Discard while this create was in flight: the placeholder and its pending members are gone,
  // so persisting now would resurrect the squad the user just threw away.
  if (!get(parentPendingCreateMembers)[parent.id]) {
    console.warn('[squad-pair-create] retry finished after discard; abandoning group', gid);
    return;
  }

  const finalized: Squad = {
    ...parent,
    id: gid,
    channels,
    updatedAt: Date.now(),
  };
  await persistCreatedSquad(parent.id, finalized);
  void initSquadBot(gid);
  const myNpub = get(currentUser)?.npub;
  applySquadCreateNetwork(myNpub, gid, get(parentPendingCreateOptions)[parent.id]?.network);
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
  const skippedNotice = skippedMembersNotice(skippedMembers);
  const pendingNotice = pendingInvitesNotice(pendingInvites);
  if (skippedMembers.length > 0) warnSkippedMembers(skippedMembers);
  if (pendingInvites.length > 0) warnPendingInvites(pendingInvites);
  const readyNotice = [skippedNotice, pendingNotice].filter(Boolean).join(' ');
  pendingReadyToast.set({
    text:
      readyNotice ||
      get(t)('nav.navbar.organizeSquad.squadReady', { values: { squadName: parent.name } }),
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
  parentPendingCreateOptions.update((m) => {
    const next = { ...m };
    delete next[parent.id];
    return next;
  });
  const skippedNpubs = new Set(skippedMembers.map((s) => s.npub));
  const pairing =
    parent.kind === 'squad-pair' && parent.pairedSquads
      ? { kind: 'squad-pair' as const, pairedSquads: parent.pairedSquads }
      : {};
  for (const npub of memberIds) {
    if (skippedNpubs.has(npub)) continue;
    try {
      await sendSquadInviteDm(
        npub,
        { squadName: parent.name, groupId: gid, iconUrl: parent.iconUrl, ...pairing },
        myNpub
      );
    } catch (e) {
      console.warn('[squad-pair-create] retry invite DM failed for', npub.slice(0, 20) + '…', e);
    }
  }
  schedulePublicSquadCreateBroadcast(gid, () => resolvePublicSquadBroadcastTarget(gid));
}
