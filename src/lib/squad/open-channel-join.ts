/**
 * Accept open-channel MLS welcomes, then attach the sidebar row.
 */

import { get } from 'svelte/store';
import { listMlsGroups, listPendingMlsWelcomes } from '../api/nostr';
import { acceptStagedChannelWelcome, attachChannelToParent } from '../invites/accept-invite';
import { sameMlsGroupId } from '../invites/declined-welcomes';
import { offeredWelcomes } from '../invites/pending-welcomes';
import {
  isHubChannelRow,
  openCustomChannelTargets,
  type ChannelAccess,
} from '../parent/channel-access';
import { blockedDmNpubs } from '../../stores/dm';
import { declinedWelcomeGroupIds } from '../../stores/invite-decisions';
import { pendingSquadAdmissions } from '../../stores/pending-squad-admission';
import { pendingWelcomeFinalizations } from '../../stores/pending-welcome-finalization';
import { squads } from '../../stores/squads';
import { dmError } from '../utils/dm-debug';
import {
  forgetPendingOpenChannelJoin,
  pendingOpenChannelJoins,
  pruneExpiredPendingOpenChannelJoins,
  type PendingOpenChannelJoin,
} from './pending-open-channel-joins';

export type OpenChannelJoinTarget = {
  parentId: string;
  groupId: string;
  name: string;
  access: ChannelAccess;
};

type PendingWelcomes = Awaited<ReturnType<typeof listPendingMlsWelcomes>>;

const completingGroupIds = new Set<string>();
const catalogRequestedGroupIds = new Set<string>();

export function resetOpenChannelJoinSessionForTests(): void {
  completingGroupIds.clear();
  catalogRequestedGroupIds.clear();
}

function wantedJoinForGroup(groupId: string): PendingOpenChannelJoin | undefined {
  return get(pendingOpenChannelJoins).find((row) => sameMlsGroupId(row.groupId, groupId));
}

function localCustomChannelTarget(groupId: string): OpenChannelJoinTarget | null {
  for (const squad of get(squads)) {
    const channel = squad.channels.find((ch) => sameMlsGroupId(ch.groupId, groupId));
    if (!channel || isHubChannelRow(channel)) continue;
    const access: ChannelAccess = channel.access === 'closed' ? 'closed' : 'open';
    return { parentId: squad.id, groupId: channel.groupId, name: channel.name, access };
  }
  return null;
}

/** Catch up / offered-welcome: this group is a wanted or already-local custom channel. */
export function openChannelJoinTarget(groupId: string): OpenChannelJoinTarget | null {
  const id = groupId.trim();
  if (!id) return null;
  const wanted = wantedJoinForGroup(id);
  if (wanted) {
    return {
      parentId: wanted.parentId,
      groupId: wanted.groupId,
      name: wanted.name,
      access: wanted.access === 'closed' ? 'closed' : 'open',
    };
  }
  return localCustomChannelTarget(id);
}

function parentHasChannel(parentId: string, groupId: string): boolean {
  const parent = get(squads).find((s) => s.id === parentId);
  return !!parent?.channels.some((ch) => sameMlsGroupId(ch.groupId, groupId));
}

function drainTargets(groupId?: string): OpenChannelJoinTarget[] {
  const wanted: OpenChannelJoinTarget[] = get(pendingOpenChannelJoins).map((row) => ({
    parentId: row.parentId,
    groupId: row.groupId,
    name: row.name,
    access: row.access === 'closed' ? 'closed' : 'open',
  }));
  const wantedKeys = new Set(wanted.map((row) => row.groupId.trim().toLowerCase()));
  const ghosts: OpenChannelJoinTarget[] = [];
  for (const squad of get(squads)) {
    for (const channel of openCustomChannelTargets(squad.channels)) {
      const gid = channel.groupId.trim();
      if (wantedKeys.has(gid.toLowerCase())) continue;
      ghosts.push({ parentId: squad.id, groupId: gid, name: channel.name, access: 'open' });
    }
  }
  const all = [...wanted, ...ghosts];
  return groupId ? all.filter((row) => sameMlsGroupId(row.groupId, groupId)) : all;
}

async function completeOpenChannelJoin(
  target: OpenChannelJoinTarget,
  welcomes: PendingWelcomes,
  joinedGroupIds: string[],
): Promise<void> {
  if (target.access === 'closed') return;
  const key = target.groupId.trim().toLowerCase();
  if (!key || completingGroupIds.has(key)) return;
  completingGroupIds.add(key);
  try {
    const welcome = welcomes.find((row) => sameMlsGroupId(row.nostr_group_id, target.groupId));
    if (welcome) {
      await acceptStagedChannelWelcome({
        welcomeId: welcome.id,
        channelGroupId: welcome.nostr_group_id?.trim() || target.groupId,
        parentId: target.parentId,
        channelName: target.name,
        access: 'open',
      });
      forgetPendingOpenChannelJoin(target.groupId);
      return;
    }
    const alreadyJoined = joinedGroupIds.some((id) => sameMlsGroupId(id, target.groupId));
    if (!alreadyJoined) return;
    if (!parentHasChannel(target.parentId, target.groupId)) {
      attachChannelToParent(target.parentId, target.groupId, target.name, 'open');
    }
    forgetPendingOpenChannelJoin(target.groupId);
  } catch (e) {
    dmError('completeOpenChannelJoin', e);
  } finally {
    completingGroupIds.delete(key);
  }
}

/**
 * A pending Welcome that is not a squad, channel, or wanted join most likely belongs to a
 * channel whose catalog has not arrived yet; ask peers to republish it (once per group).
 */
async function requestCatalogForUnmatchedWelcome(
  groupId: string,
  welcomes: PendingWelcomes,
): Promise<void> {
  const key = groupId.toLowerCase();
  if (catalogRequestedGroupIds.has(key)) return;
  if (get(pendingWelcomeFinalizations).some((row) => sameMlsGroupId(row.groupId, groupId))) return;
  const parents = get(squads);
  if (parents.length === 0) return;
  const unmatched = offeredWelcomes({
    welcomes: welcomes.filter((row) => sameMlsGroupId(row.nostr_group_id, groupId)),
    squadIds: parents.map((s) => s.id),
    declinedGroupIds: get(declinedWelcomeGroupIds),
    pendingAdmissionGroupIds: get(pendingSquadAdmissions).map((p) => p.groupId),
    blockedNpubs: get(blockedDmNpubs),
    unmaterialized: [],
  });
  if (unmatched.length === 0) return;
  catalogRequestedGroupIds.add(key);
  try {
    const { requestSquadStateSync } = await import('./squad-state-sync');
    for (const parent of parents) void requestSquadStateSync(parent.id);
  } catch (e) {
    catalogRequestedGroupIds.delete(key);
    dmError('requestSquadStateSync for unmatched welcome', e);
  }
}

export async function tryCompleteOpenChannelJoins(groupId?: string | null): Promise<void> {
  pruneExpiredPendingOpenChannelJoins();
  const filter = groupId?.trim() || undefined;
  const targets = drainTargets(filter);
  if (targets.length === 0 && !filter) return;
  let welcomes: PendingWelcomes;
  try {
    welcomes = await listPendingMlsWelcomes();
  } catch (e) {
    dmError('listPendingMlsWelcomes for open-channel join', e);
    return;
  }
  if (targets.length === 0 && filter) {
    await requestCatalogForUnmatchedWelcome(filter, welcomes);
    return;
  }
  let joinedGroupIds: string[] = [];
  try {
    joinedGroupIds = await listMlsGroups();
  } catch (e) {
    dmError('listMlsGroups for open-channel join', e);
  }
  for (const target of targets) {
    await completeOpenChannelJoin(target, welcomes, joinedGroupIds);
  }
}
