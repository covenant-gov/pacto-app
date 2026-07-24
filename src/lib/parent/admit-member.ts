/**
 * Consent-finalized admit: MLS-add to announcements + every open custom channel.
 */

import { get } from 'svelte/store';
import { inviteMemberToGroup, getMlsGroupMembers, sendDmMessage } from '../api/nostr';
import { getAnnouncementsChannel } from '../parent-navbar';
import { openCustomChannelTargets } from './channel-access';
import { getInvokeErrorMessage, friendlyMessage } from '../utils/tauri-errors';
import { formatChannelInSquadMessage } from '../api/nostr';
import type { Squad } from '../../stores/squads';
import { squads } from '../../stores/squads';

const admitInFlight = new Set<string>();

function admitKey(parentId: string, memberNpub: string): string {
  return `${parentId.trim().toLowerCase()}:${memberNpub.trim().toLowerCase()}`;
}

export type AdmitMemberResult = {
  ok: boolean;
  announcementsOk: boolean;
  openChannelsInvited: number;
  error?: string;
};

async function alreadyInGroup(groupId: string, memberNpub: string): Promise<boolean> {
  try {
    const result = await getMlsGroupMembers(groupId);
    return (result.members ?? []).includes(memberNpub);
  } catch {
    return false;
  }
}

/**
 * Under-the-hood notify so the joiner auto-accepts the channel welcome and attaches catalog.
 * Suppressed as an invite card when already in squad (backend).
 */
async function notifyChannelWelcome(
  parent: Squad,
  channelGroupId: string,
  channelName: string,
  memberNpub: string,
): Promise<void> {
  const announcements = getAnnouncementsChannel(parent);
  const payload = formatChannelInSquadMessage({
    type: 'channel_in_squad',
    squadName: parent.name,
    announcementsGroupId: announcements.groupId,
    channelGroupId,
    channelName,
  });
  await sendDmMessage(memberNpub, payload);
}

/** MLS-admit one member into announcements; open channels continue in the background. */
export async function admitMemberToSquad(opts: {
  parent: Squad;
  memberNpub: string;
}): Promise<AdmitMemberResult> {
  const { parent, memberNpub } = opts;
  const npub = memberNpub.trim();
  const announcements = getAnnouncementsChannel(parent);
  const announcementsGid = announcements.groupId?.trim();
  if (!announcementsGid || !npub) {
    return { ok: false, announcementsOk: false, openChannelsInvited: 0, error: 'Squad not ready.' };
  }

  const key = admitKey(parent.id, npub);
  if (admitInFlight.has(key)) {
    return { ok: true, announcementsOk: true, openChannelsInvited: 0 };
  }
  admitInFlight.add(key);

  try {
    if (!(await alreadyInGroup(announcementsGid, npub))) {
      try {
        await inviteMemberToGroup(announcementsGid, npub);
      } catch (e) {
        const lastErr = friendlyMessage(getInvokeErrorMessage(e));
        admitInFlight.delete(key);
        return {
          ok: false,
          announcementsOk: false,
          openChannelsInvited: 0,
          error: lastErr || 'Could not add to announcements.',
        };
      }
    }

    const liveParent = get(squads).find((s) => s.id === parent.id) ?? parent;
    // Announcements welcome is enough for in-squad; open channels catch up under the hood.
    void inviteOpenChannelsInBackground(liveParent, npub, key);

    return {
      ok: true,
      announcementsOk: true,
      openChannelsInvited: 0,
    };
  } catch (e) {
    admitInFlight.delete(key);
    throw e;
  }
}

async function inviteOpenChannelsInBackground(
  parent: Squad,
  npub: string,
  admitKeyForMember: string,
): Promise<void> {
  try {
    for (const ch of openCustomChannelTargets(parent.channels)) {
      try {
        if (await alreadyInGroup(ch.groupId, npub)) continue;
        await inviteMemberToGroup(ch.groupId, npub);
        try {
          await notifyChannelWelcome(parent, ch.groupId, ch.name, npub);
        } catch (e) {
          console.warn('[admit] channel notify failed', ch.groupId.slice(0, 12), e);
        }
      } catch (e) {
        console.warn('[admit] open channel invite failed', ch.groupId.slice(0, 12), e);
      }
    }
  } finally {
    admitInFlight.delete(admitKeyForMember);
  }
}

export function runAdmitMembersToSquad(opts: {
  parent: Squad;
  npubs: string[];
  onErrorBanner: (message: string) => void;
  onComplete: (admittedNpubs: string[]) => void;
}): void {
  const { parent, npubs, onErrorBanner, onComplete } = opts;
  void (async () => {
    const admitted: string[] = [];
    let lastErr = '';
    for (const npub of npubs) {
      const result = await admitMemberToSquad({ parent, memberNpub: npub });
      if (result.ok) admitted.push(npub);
      if (result.error) lastErr = result.error;
    }
    if (lastErr) onErrorBanner(lastErr);
    onComplete(admitted);
  })();
}
