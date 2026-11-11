/**
 * Accept open-channel MLS welcomes, then attach the sidebar row.
 */

import { get } from 'svelte/store';
import { listMlsGroups, listPendingMlsWelcomes } from '../api/nostr';
import {
  acceptStagedChannelWelcome,
  attachChannelToParent,
  sameMlsGroupId,
} from '../invites/accept-invite';
import { isHubChannelRow, isOpenCustomChannel, type ChannelAccess } from '../parent/channel-access';
import { squads } from '../../stores/squads';
import { dmError } from '../utils/dm-debug';
import {
  forgetPendingOpenChannelJoin,
  pendingOpenChannelJoins,
  type PendingOpenChannelJoin,
} from './pending-open-channel-joins';

export type OpenChannelJoinTarget = {
  parentId: string;
  groupId: string;
  name: string;
  access: ChannelAccess;
};

const completingGroupIds = new Set<string>();

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
    for (const channel of squad.channels) {
      if (!isOpenCustomChannel(channel)) continue;
      const gid = channel.groupId.trim();
      if (!gid || wantedKeys.has(gid.toLowerCase())) continue;
      ghosts.push({
        parentId: squad.id,
        groupId: gid,
        name: channel.name,
        access: 'open',
      });
    }
  }
  const all = [...wanted, ...ghosts];
  const filter = groupId?.trim();
  return filter ? all.filter((row) => sameMlsGroupId(row.groupId, filter)) : all;
}

async function completeOpenChannelJoin(
  target: OpenChannelJoinTarget,
  welcomes: Awaited<ReturnType<typeof listPendingMlsWelcomes>>,
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
    attachChannelToParent(target.parentId, target.groupId, target.name, 'open');
    forgetPendingOpenChannelJoin(target.groupId);
  } catch (e) {
    dmError('completeOpenChannelJoin', e);
  } finally {
    completingGroupIds.delete(key);
  }
}

export async function tryCompleteOpenChannelJoins(groupId?: string | null): Promise<void> {
  const targets = drainTargets(groupId ?? undefined);
  if (targets.length === 0) return;
  let welcomes: Awaited<ReturnType<typeof listPendingMlsWelcomes>>;
  try {
    welcomes = await listPendingMlsWelcomes();
  } catch (e) {
    dmError('listPendingMlsWelcomes for open-channel join', e);
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
