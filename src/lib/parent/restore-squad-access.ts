/**
 * Squad-level restore: announcements first, then every channel the member still
 * belongs to, plus open channels they are missing.
 */

import { get } from 'svelte/store';
import { getMlsGroupMembers, inviteMemberToGroup, sendDmMessage, formatChannelInSquadMessage } from '../api/nostr';
import { getAnnouncementsChannel } from '../parent-navbar';
import { isOpenCustomChannel } from './channel-access';
import { sameMlsGroupId } from '../invites/declined-welcomes';
import { getInvokeErrorMessage, friendlyMessage } from '../utils/tauri-errors';
import { currentUser } from '../../stores/auth-session';
import { bumpMembershipVersion } from '../../stores/mls-chat';
import { refreshMlsGroupMembers } from '../../stores/mls-group-members';
import { squads, type Channel, type Squad } from '../../stores/squads';
import { t } from 'svelte-i18n';

const restoreInFlight = new Set<string>();
const lastRestoreAt = new Map<string, number>();
const RESTORE_COOLDOWN_MS = 60_000;

/** Re-add changed the group's leaves: let any open members panel repaint. */
function noteMembershipChanged(groupId: string): void {
  bumpMembershipVersion(groupId);
  void refreshMlsGroupMembers(groupId).catch(() => {});
}

export interface GroupMembershipSnapshot {
  members: string[];
  admins: string[];
}

export interface RestoreChannelPlan {
  restoreGroupIds: string[];
  admitOpen: Array<{ groupId: string; name: string }>;
}

export type RestoreSquadResult =
  | { ok: true; skipped?: 'cooldown' | 'in_flight' }
  | { ok: false; error: string };

function restoreKey(parentId: string, memberNpub: string): string {
  return `${parentId.trim().toLowerCase()}:${memberNpub.trim().toLowerCase()}`;
}

function listed(npubs: string[], npub: string): boolean {
  return npubs.some((n) => sameMlsGroupId(n, npub));
}

/** Squad whose announcements group id matches; channel groups never match. */
export function squadForAnnouncementsGroup(list: Squad[], groupId: string): Squad | undefined {
  const gid = groupId.trim();
  if (!gid) return undefined;
  return list.find((s) => sameMlsGroupId(getAnnouncementsChannel(s).groupId ?? '', gid));
}

function membershipFor(
  membershipByGroupId: Map<string, GroupMembershipSnapshot | null>,
  groupId: string,
): GroupMembershipSnapshot | null | undefined {
  if (membershipByGroupId.has(groupId)) return membershipByGroupId.get(groupId);
  const key = groupId.toLowerCase();
  for (const [id, snap] of membershipByGroupId) {
    if (sameMlsGroupId(id, key)) return snap;
  }
  return undefined;
}

/**
 * Channels to restore or admit after announcements.
 * A null snapshot means this device is not in that group.
 * An existing leaf is restored only when this device admins the channel.
 * A missing open channel is admitted by any member of that channel.
 */
export function planSquadMemberRestore(opts: {
  channels: Channel[];
  announcementsGroupId: string;
  memberNpub: string;
  selfNpub: string;
  membershipByGroupId: Map<string, GroupMembershipSnapshot | null>;
}): RestoreChannelPlan {
  const announcements = opts.announcementsGroupId.trim();
  const member = opts.memberNpub.trim();
  const self = opts.selfNpub.trim();
  const restoreGroupIds: string[] = [];
  const admitOpen: Array<{ groupId: string; name: string }> = [];
  const seen = new Set<string>();

  for (const ch of opts.channels) {
    const gid = ch.groupId.trim();
    if (!gid || gid.startsWith('creating-') || gid.startsWith('__')) continue;
    if (!announcements || sameMlsGroupId(gid, announcements)) continue;
    const key = gid.toLowerCase();
    if (seen.has(key)) continue;
    const snap = membershipFor(opts.membershipByGroupId, gid);
    if (!snap) continue;
    seen.add(key);
    const hasLeaf = listed(snap.members, member);
    const selfIsAdmin = listed(snap.admins, self);
    if (hasLeaf) {
      if (selfIsAdmin) restoreGroupIds.push(gid);
      continue;
    }
    if (isOpenCustomChannel(ch)) admitOpen.push({ groupId: gid, name: ch.name });
  }

  return { restoreGroupIds, admitOpen };
}

async function notifyChannelWelcome(
  parent: Squad,
  channelGroupId: string,
  channelName: string,
  memberNpub: string,
): Promise<void> {
  const announcements = getAnnouncementsChannel(parent);
  await sendDmMessage(
    memberNpub,
    formatChannelInSquadMessage({
      type: 'channel_in_squad',
      squadName: parent.name,
      announcementsGroupId: announcements.groupId,
      channelGroupId,
      channelName,
    }),
  );
}

async function restoreChannelsInBackground(
  parent: Squad,
  npub: string,
  announcementsGid: string,
  key: string,
): Promise<void> {
  try {
    const self = get(currentUser)?.npub?.trim() ?? '';
    if (!self) return;
    const targets = parent.channels.filter((ch) => {
      const gid = ch.groupId.trim();
      return gid && !gid.startsWith('creating-') && !gid.startsWith('__') && !sameMlsGroupId(gid, announcementsGid);
    });
    const membershipByGroupId = new Map<string, GroupMembershipSnapshot | null>();
    await Promise.all(
      targets.map(async (ch) => {
        try {
          const result = await getMlsGroupMembers(ch.groupId);
          membershipByGroupId.set(ch.groupId, {
            members: result.members ?? [],
            admins: result.admins ?? [],
          });
        } catch {
          membershipByGroupId.set(ch.groupId, null);
        }
      }),
    );
    const plan = planSquadMemberRestore({
      channels: parent.channels,
      announcementsGroupId: announcementsGid,
      memberNpub: npub,
      selfNpub: self,
      membershipByGroupId,
    });
    for (const gid of plan.restoreGroupIds) {
      try {
        await inviteMemberToGroup(gid, npub);
      } catch (e) {
        console.warn('[mls] channel restore failed', gid.slice(0, 12), e);
        continue;
      }
      noteMembershipChanged(gid);
      const name = parent.channels.find((ch) => sameMlsGroupId(ch.groupId, gid))?.name ?? gid;
      try {
        await notifyChannelWelcome(parent, gid, name, npub);
      } catch (e) {
        console.warn('[mls] channel notify failed', gid.slice(0, 12), e);
      }
    }
    for (const ch of plan.admitOpen) {
      try {
        await inviteMemberToGroup(ch.groupId, npub);
        noteMembershipChanged(ch.groupId);
        try {
          await notifyChannelWelcome(parent, ch.groupId, ch.name, npub);
        } catch (e) {
          console.warn('[mls] channel notify failed', ch.groupId.slice(0, 12), e);
        }
      } catch (e) {
        console.warn('[mls] open channel admit failed', ch.groupId.slice(0, 12), e);
      }
    }
  } finally {
    restoreInFlight.delete(key);
  }
}

/** Remove-then-re-add on announcements, then the member's other channels. */
export async function restoreMemberToSquad(opts: {
  parent: Squad;
  memberNpub: string;
}): Promise<RestoreSquadResult> {
  const npub = opts.memberNpub.trim();
  const announcementsGid = getAnnouncementsChannel(opts.parent).groupId?.trim() ?? '';
  if (!announcementsGid || !npub) {
    return { ok: false, error: get(t)('squad.access.notReady') };
  }
  const key = restoreKey(opts.parent.id, npub);
  if (restoreInFlight.has(key)) return { ok: true, skipped: 'in_flight' };
  const last = lastRestoreAt.get(key) ?? 0;
  if (Date.now() - last < RESTORE_COOLDOWN_MS) return { ok: true, skipped: 'cooldown' };

  restoreInFlight.add(key);
  try {
    await inviteMemberToGroup(announcementsGid, npub);
  } catch (e) {
    restoreInFlight.delete(key);
    return {
      ok: false,
      error: friendlyMessage(getInvokeErrorMessage(e, get(t)('squad.access.restoreFailed'))),
    };
  }
  lastRestoreAt.set(key, Date.now());
  noteMembershipChanged(announcementsGid);
  const liveParent = get(squads).find((s) => s.id === opts.parent.id) ?? opts.parent;
  void restoreChannelsInBackground(liveParent, npub, announcementsGid, key);
  return { ok: true };
}

export function resetRestoreSquadAccessState(): void {
  restoreInFlight.clear();
  lastRestoreAt.clear();
}
