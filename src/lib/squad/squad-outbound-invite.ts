/**
 * Outbound squad invite: pending announce on announcements + accept claim via DM to admitters.
 */

import { get } from 'svelte/store';
import { sendDmMessage } from '../api/nostr';
import { currentUser } from '../../stores/auth';
import { admitMemberToSquad } from '../parent/admit-member';
import type { Squad } from '../../stores/squads';
import { squads } from '../../stores/squads';
import { getAnnouncementsChannel } from '../parent-navbar';

export const SQUAD_OUTBOUND_INVITE_TYPE = 'squad_outbound_invite';
export const SQUAD_INVITE_ACCEPTED_TYPE = 'squad_invite_accepted';
export const SQUAD_ADMIT_NEEDED_TYPE = 'squad_admit_needed';

export type SquadOutboundInvitePayload = {
  parent_id: string;
  invite_id: string;
  invitee_npub: string;
  squad_name: string;
};

export type SquadInviteAcceptedPayload = {
  parent_id: string;
  invite_id: string;
  invitee_npub: string;
  squad_name: string;
};

export type SquadAdmitNeededPayload = {
  parent_id: string;
  invite_id: string;
  invitee_npub: string;
};

const pendingOutboundByInviteId = new Map<string, SquadOutboundInvitePayload>();
const handledAcceptKeys = new Set<string>();
const HANDLED_CAP = 200;

function pruneHandled(): void {
  while (handledAcceptKeys.size > HANDLED_CAP) {
    const oldest = handledAcceptKeys.values().next().value;
    if (oldest === undefined) break;
    handledAcceptKeys.delete(oldest);
  }
}

export function resetOutboundInviteStateForTests(): void {
  pendingOutboundByInviteId.clear();
  handledAcceptKeys.clear();
}

export function formatSquadOutboundInvite(payload: SquadOutboundInvitePayload): string {
  return JSON.stringify({
    type: SQUAD_OUTBOUND_INVITE_TYPE,
    payload,
    pacto_virtual_bucket: 'announcements',
  });
}

export function parseSquadOutboundInvite(content: string | null | undefined): SquadOutboundInvitePayload | null {
  if (!content?.trim().startsWith('{')) return null;
  try {
    const root = JSON.parse(content) as Record<string, unknown>;
    if (root.type !== SQUAD_OUTBOUND_INVITE_TYPE) return null;
    const p = root.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') return null;
    const parent_id = typeof p.parent_id === 'string' ? p.parent_id.trim() : '';
    const invite_id = typeof p.invite_id === 'string' ? p.invite_id.trim() : '';
    const invitee_npub = typeof p.invitee_npub === 'string' ? p.invitee_npub.trim() : '';
    const squad_name = typeof p.squad_name === 'string' ? p.squad_name.trim() : '';
    if (!parent_id || !invite_id || !invitee_npub) return null;
    return { parent_id, invite_id, invitee_npub, squad_name };
  } catch {
    return null;
  }
}

export function formatSquadInviteAccepted(payload: SquadInviteAcceptedPayload): string {
  return JSON.stringify({ type: SQUAD_INVITE_ACCEPTED_TYPE, payload });
}

export function parseSquadInviteAccepted(content: string | null | undefined): SquadInviteAcceptedPayload | null {
  if (!content?.trim().startsWith('{')) return null;
  try {
    const root = JSON.parse(content) as Record<string, unknown>;
    if (root.type !== SQUAD_INVITE_ACCEPTED_TYPE) return null;
    const p = root.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') return null;
    const parent_id = typeof p.parent_id === 'string' ? p.parent_id.trim() : '';
    const invite_id = typeof p.invite_id === 'string' ? p.invite_id.trim() : '';
    const invitee_npub = typeof p.invitee_npub === 'string' ? p.invitee_npub.trim() : '';
    const squad_name = typeof p.squad_name === 'string' ? p.squad_name.trim() : '';
    if (!parent_id || !invite_id || !invitee_npub) return null;
    return { parent_id, invite_id, invitee_npub, squad_name };
  } catch {
    return null;
  }
}

export function formatSquadAdmitNeeded(payload: SquadAdmitNeededPayload): string {
  return JSON.stringify({
    type: SQUAD_ADMIT_NEEDED_TYPE,
    payload,
    pacto_virtual_bucket: 'announcements',
  });
}

export function parseSquadAdmitNeeded(content: string | null | undefined): SquadAdmitNeededPayload | null {
  if (!content?.trim().startsWith('{')) return null;
  try {
    const root = JSON.parse(content) as Record<string, unknown>;
    if (root.type !== SQUAD_ADMIT_NEEDED_TYPE) return null;
    const p = root.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') return null;
    const parent_id = typeof p.parent_id === 'string' ? p.parent_id.trim() : '';
    const invite_id = typeof p.invite_id === 'string' ? p.invite_id.trim() : '';
    const invitee_npub = typeof p.invitee_npub === 'string' ? p.invitee_npub.trim() : '';
    if (!parent_id || !invite_id || !invitee_npub) return null;
    return { parent_id, invite_id, invitee_npub };
  } catch {
    return null;
  }
}

export function rememberOutboundInvite(payload: SquadOutboundInvitePayload): void {
  pendingOutboundByInviteId.set(payload.invite_id, payload);
}

export function publishOutboundInviteAnnounce(parent: Squad, inviteId: string, inviteeNpub: string): Promise<boolean> {
  const announcements = getAnnouncementsChannel(parent);
  const gid = announcements.groupId?.trim();
  if (!gid) return Promise.resolve(false);
  const payload: SquadOutboundInvitePayload = {
    parent_id: gid,
    invite_id: inviteId,
    invitee_npub: inviteeNpub.trim(),
    squad_name: parent.name,
  };
  rememberOutboundInvite(payload);
  const json = formatSquadOutboundInvite(payload);
  return sendDmMessage(gid, json, '', { virtualBucket: 'announcements' });
}

export async function publishInviteAcceptedClaims(opts: {
  parentId: string;
  inviteId: string;
  inviteeNpub: string;
  squadName: string;
  admitterNpubs: string[];
}): Promise<void> {
  const body = formatSquadInviteAccepted({
    parent_id: opts.parentId,
    invite_id: opts.inviteId,
    invitee_npub: opts.inviteeNpub,
    squad_name: opts.squadName,
  });
  const targets = [...new Set(opts.admitterNpubs.map((n) => n.trim()).filter(Boolean))];
  await Promise.allSettled(
    targets
      .filter((npub) => npub !== opts.inviteeNpub)
      .map(async (npub) => {
        try {
          await sendDmMessage(npub, body);
        } catch (e) {
          console.warn('[outbound-invite] accept claim DM failed', npub.slice(0, 16), e);
        }
      }),
  );
}

function acceptHandleKey(inviteId: string, inviteeNpub: string): string {
  return `${inviteId}:${inviteeNpub.trim().toLowerCase()}`;
}

/** Peer received invitee accept claim (DM) or admit_needed (MLS): run admit once. */
export async function handleInviteeConsentForAdmit(
  payload: { parent_id: string; invite_id: string; invitee_npub: string },
  opts?: { broadcastAdmitNeeded?: boolean },
): Promise<void> {
  const me = get(currentUser)?.npub?.trim();
  if (!me) return;
  if (payload.invitee_npub === me) return;

  const key = acceptHandleKey(payload.invite_id, payload.invitee_npub);
  if (handledAcceptKeys.has(key)) return;
  handledAcceptKeys.add(key);
  pruneHandled();

  const parent =
    get(squads).find((s) => s.id === payload.parent_id) ??
    get(squads).find((s) => getAnnouncementsChannel(s).groupId === payload.parent_id);
  if (!parent) return;

  await admitMemberToSquad({ parent, memberNpub: payload.invitee_npub });
  // Keep handledAcceptKeys even on failure. Removing it let every subsequent
  // admit_needed broadcast for the same invite re-trigger a retry storm.

  if (opts?.broadcastAdmitNeeded) {
    const announcements = getAnnouncementsChannel(parent);
    const gid = announcements.groupId?.trim();
    if (gid) {
      try {
        await sendDmMessage(
          gid,
          formatSquadAdmitNeeded({
            parent_id: gid,
            invite_id: payload.invite_id,
            invitee_npub: payload.invitee_npub,
          }),
          '',
          { virtualBucket: 'announcements' },
        );
      } catch (e) {
        console.warn('[outbound-invite] admit_needed publish failed', e);
      }
    }
  }
}

export function onMlsOutboundInviteAnnounce(content: string): void {
  const parsed = parseSquadOutboundInvite(content);
  if (parsed) rememberOutboundInvite(parsed);
}

export function onMlsAdmitNeeded(content: string, groupId: string): void {
  const parsed = parseSquadAdmitNeeded(content);
  if (!parsed) return;
  if (parsed.parent_id !== groupId.trim()) return;
  void handleInviteeConsentForAdmit(parsed, { broadcastAdmitNeeded: false });
}
