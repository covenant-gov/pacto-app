/**
 * Consent-first squad invite: outbound announce + DM with inviteId.
 * Does not MLS-add — admit runs only after the invitee Accepts.
 */

import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { getMlsGroupMembers, type SquadInvitePayload } from '../api/nostr';
import { getAnnouncementsChannel } from '../parent-navbar';
import { sendSquadInviteDm } from '../pacto-app-inbox';
import { publishOutboundInviteAnnounce } from './squad-outbound-invite';
import { getInvokeErrorMessage, friendlyMessage } from '../utils/tauri-errors';
import { currentUser } from '../../stores/auth';
import type { Squad } from '../../stores/squads';

function tt(
  key: string,
  values?: Record<string, string | number | boolean | Date | null | undefined>
): string {
  try {
    const translate = get(t);
    return values ? translate(key, { values }) : translate(key);
  } catch {
    return key;
  }
}

export function newInviteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `inv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Resolve admitter npubs for a consent-first claim (MLS roster + self). */
export async function resolveAdmitterNpubs(
  announcementsGroupId: string,
  myNpub: string | undefined
): Promise<string[]> {
  try {
    const members = await getMlsGroupMembers(announcementsGroupId);
    return [...new Set([...(members.members ?? []), myNpub].filter(Boolean) as string[])];
  } catch {
    return myNpub ? [myNpub] : [];
  }
}

export type ConsentFirstInviteResult =
  | { ok: true; inviteId: string }
  | { ok: false; error: string };

/**
 * Publish outbound announce + send full squad_invite DM (inviteId + admitters).
 * Caller supplies a ready parent with announcements groupId.
 */
export async function sendConsentFirstSquadInvite(
  parent: Squad,
  inviteeNpub: string,
  opts?: { admitterNpubs?: string[] }
): Promise<ConsentFirstInviteResult> {
  const announcements = getAnnouncementsChannel(parent);
  const groupId = announcements.groupId?.trim();
  if (!groupId) {
    return { ok: false, error: tt('squad.consentFirstInvite.channelsNotReady') };
  }

  const invitee = inviteeNpub.trim();
  if (!invitee.startsWith('npub1')) {
    return { ok: false, error: tt('squad.consentFirstInvite.invalidInvitee') };
  }

  const myNpub = get(currentUser)?.npub;
  const admitterNpubs =
    opts?.admitterNpubs ?? (await resolveAdmitterNpubs(groupId, myNpub));
  if (admitterNpubs.length === 0) {
    return { ok: false, error: tt('squad.consentFirstInvite.noAdmitters') };
  }

  const inviteId = newInviteId();
  let announced: boolean;
  try {
    announced = await publishOutboundInviteAnnounce(parent, inviteId, invitee);
  } catch (e) {
    console.warn('[consent-first-invite] outbound announce failed', e);
    return { ok: false, error: tt('squad.consentFirstInvite.announceFailed') };
  }
  if (!announced) {
    return { ok: false, error: tt('squad.consentFirstInvite.announceFailed') };
  }

  const invitePayload: Omit<SquadInvitePayload, 'type'> = {
    squadName: parent.name,
    groupId,
    inviteId,
    admitterNpubs,
    kind: parent.kind === 'squad-pair' ? 'squad-pair' : 'squad',
    pairedSquads: parent.pairedSquads,
    iconUrl: parent.iconUrl,
  };

  try {
    await sendSquadInviteDm(invitee, invitePayload, myNpub);
    return { ok: true, inviteId };
  } catch (e) {
    console.warn('[consent-first-invite] squad invite DM failed for', invitee.slice(0, 20) + '…', e);
    return { ok: false, error: friendlyMessage(getInvokeErrorMessage(e)) };
  }
}
