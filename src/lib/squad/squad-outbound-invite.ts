/**
 * Outbound squad invite: pending announce on announcements + accept claim via DM to admitters.
 */

import { get } from 'svelte/store';
import { getDmMessages, getMlsGroupMembers, sendDmMessage } from '../api/nostr';
import { currentUser } from '../../stores/auth-session';
import { admitMemberToSquad } from '../parent/admit-member';
import { clearPendingAdmitForMember, enqueuePendingAdmit } from '../parent/pending-admit';
import type { Squad } from '../../stores/squads';
import { squads } from '../../stores/squads';
import { getAnnouncementsChannel } from '../parent-navbar';

export const SQUAD_OUTBOUND_INVITE_TYPE = 'squad_outbound_invite';
export const SQUAD_OUTBOUND_INVITE_REVOKED_TYPE = 'squad_outbound_invite_revoked';
export const SQUAD_INVITE_ACCEPTED_TYPE = 'squad_invite_accepted';
export const SQUAD_ADMIT_NEEDED_TYPE = 'squad_admit_needed';

export type SquadOutboundInvitePayload = {
  parent_id: string;
  invite_id: string;
  invitee_npub: string;
  squad_name: string;
};

export type SquadOutboundInviteRevokedPayload = {
  parent_id: string;
  invite_id: string;
  invitee_npub: string;
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

/** Pending outbound invite row for Access settings. */
export type PendingOutboundInviteDto = {
  parentId: string;
  inviteId: string;
  inviteeNpub: string;
  squadName: string;
  createdAt: number;
};

const pendingOutboundInvites = new Map<string, SquadOutboundInvitePayload>();
/** Revoked invite ids (`parent_id:invite_id`). */
const revokedOutboundInviteKeys = new Set<string>();
/** Successful admits only. */
const admittedSuccessKeys = new Set<string>();
/** In-flight or already attempted this process — retries go through pending-admit drain. */
const attemptedAdmitKeys = new Set<string>();
const HANDLED_CAP = 200;

function inviteMemoryKey(parentId: string, inviteId: string): string {
  return `${parentId.trim().toLowerCase()}:${inviteId.trim()}`;
}

function pruneHandled(): void {
  while (admittedSuccessKeys.size > HANDLED_CAP) {
    const oldest = admittedSuccessKeys.values().next().value;
    if (oldest === undefined) break;
    admittedSuccessKeys.delete(oldest);
  }
  while (attemptedAdmitKeys.size > HANDLED_CAP) {
    const oldest = attemptedAdmitKeys.values().next().value;
    if (oldest === undefined) break;
    attemptedAdmitKeys.delete(oldest);
  }
  while (revokedOutboundInviteKeys.size > HANDLED_CAP) {
    const oldest = revokedOutboundInviteKeys.values().next().value;
    if (oldest === undefined) break;
    revokedOutboundInviteKeys.delete(oldest);
  }
}

export function resetOutboundInviteState(): void {
  pendingOutboundInvites.clear();
  revokedOutboundInviteKeys.clear();
  admittedSuccessKeys.clear();
  attemptedAdmitKeys.clear();
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

export function formatSquadOutboundInviteRevoked(payload: SquadOutboundInviteRevokedPayload): string {
  return JSON.stringify({
    type: SQUAD_OUTBOUND_INVITE_REVOKED_TYPE,
    payload,
    pacto_virtual_bucket: 'announcements',
  });
}

export function parseSquadOutboundInviteRevoked(
  content: string | null | undefined
): SquadOutboundInviteRevokedPayload | null {
  if (!content?.trim().startsWith('{')) return null;
  try {
    const root = JSON.parse(content) as Record<string, unknown>;
    if (root.type !== SQUAD_OUTBOUND_INVITE_REVOKED_TYPE) return null;
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
  const key = inviteMemoryKey(payload.parent_id, payload.invite_id);
  revokedOutboundInviteKeys.delete(key);
  pendingOutboundInvites.set(key, payload);
}

export function rememberOutboundInviteRevoked(payload: SquadOutboundInviteRevokedPayload): void {
  const key = inviteMemoryKey(payload.parent_id, payload.invite_id);
  revokedOutboundInviteKeys.add(key);
  pendingOutboundInvites.delete(key);
  pruneHandled();
}

export function isOutboundInviteRevoked(parentId: string, inviteId: string): boolean {
  return revokedOutboundInviteKeys.has(inviteMemoryKey(parentId, inviteId));
}

export function getRememberedOutboundInvite(
  parentId: string,
  inviteId: string
): SquadOutboundInvitePayload | undefined {
  if (isOutboundInviteRevoked(parentId, inviteId)) return undefined;
  return pendingOutboundInvites.get(inviteMemoryKey(parentId, inviteId));
}

/** Match claim to a remembered outbound invite (invite id + invitee + parent). */
export function matchesKnownOutboundInvite(payload: {
  parent_id: string;
  invite_id: string;
  invitee_npub: string;
}): boolean {
  if (isOutboundInviteRevoked(payload.parent_id, payload.invite_id)) return false;
  const known = getRememberedOutboundInvite(payload.parent_id, payload.invite_id);
  if (!known) return false;
  return (
    known.invitee_npub.trim().toLowerCase() === payload.invitee_npub.trim().toLowerCase() &&
    known.parent_id.trim().toLowerCase() === payload.parent_id.trim().toLowerCase()
  );
}

/** Load outbound announce from MLS history when memory is cold. */
export async function ensureOutboundInviteKnown(payload: {
  parent_id: string;
  invite_id: string;
  invitee_npub: string;
}): Promise<boolean> {
  if (isOutboundInviteRevoked(payload.parent_id, payload.invite_id)) return false;
  if (matchesKnownOutboundInvite(payload)) return true;
  const gid = payload.parent_id.trim();
  if (!gid) return false;
  try {
    const collected: { content: string; at: number }[] = [];
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const msgs = await getDmMessages(gid, pageSize, offset, {
        virtualBucketFilter: 'announcements',
      });
      for (const m of msgs) {
        collected.push({ content: m.content, at: m.at });
      }
      if (msgs.length < pageSize) break;
    }
    // Side-effect: remember invites/revokes with latest-wins.
    mergePendingOutboundInvitesFromMlsMessages(collected);
  } catch (e) {
    console.warn('[outbound-invite] history lookup failed', e);
  }
  return matchesKnownOutboundInvite(payload);
}

/**
 * Merge announcements timeline into pending outbound invites (latest event per invite_id wins).
 * Callers should filter roster members separately when listing for UI.
 */
export function mergePendingOutboundInvitesFromMlsMessages(
  msgs: { content: string; at: number }[]
): PendingOutboundInviteDto[] {
  type Row =
    | { kind: 'invite'; at: number; payload: SquadOutboundInvitePayload }
    | { kind: 'revoke'; at: number; payload: SquadOutboundInviteRevokedPayload };
  const byInviteId = new Map<string, Row>();

  const sorted = [...msgs].sort((a, b) => (a.at || 0) - (b.at || 0));
  for (const m of sorted) {
    const revoked = parseSquadOutboundInviteRevoked(m.content);
    if (revoked) {
      rememberOutboundInviteRevoked(revoked);
      byInviteId.set(revoked.invite_id, { kind: 'revoke', at: m.at, payload: revoked });
      continue;
    }
    const invite = parseSquadOutboundInvite(m.content);
    if (!invite) continue;
    rememberOutboundInvite(invite);
    byInviteId.set(invite.invite_id, { kind: 'invite', at: m.at, payload: invite });
  }

  const out: PendingOutboundInviteDto[] = [];
  for (const row of byInviteId.values()) {
    if (row.kind !== 'invite') continue;
    const p = row.payload;
    if (isOutboundInviteRevoked(p.parent_id, p.invite_id)) continue;
    const admitKey = acceptHandleKey(p.invite_id, p.invitee_npub);
    if (admittedSuccessKeys.has(admitKey)) continue;
    out.push({
      parentId: p.parent_id,
      inviteId: p.invite_id,
      inviteeNpub: p.invitee_npub,
      squadName: p.squad_name,
      createdAt: row.at || 0,
    });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

/** Pending outbound invites for a squad (announcements MLS group id). */
export async function loadPendingOutboundInvitesFromMls(
  parentId: string
): Promise<PendingOutboundInviteDto[]> {
  const gid = parentId.trim();
  if (!gid) return [];

  const collected: { content: string; at: number }[] = [];
  const pageSize = 200;
  try {
    for (let offset = 0; ; offset += pageSize) {
      const msgs = await getDmMessages(gid, pageSize, offset, {
        virtualBucketFilter: 'announcements',
      });
      for (const m of msgs) {
        collected.push({ content: m.content, at: m.at });
      }
      if (msgs.length < pageSize) break;
    }
  } catch (e) {
    console.warn('[outbound-invite] pending load failed', e);
    throw e;
  }

  const pending = mergePendingOutboundInvitesFromMlsMessages(collected);
  let memberSet = new Set<string>();
  try {
    const members = await getMlsGroupMembers(gid);
    memberSet = new Set((members.members ?? []).map((n) => n.trim().toLowerCase()));
  } catch (e) {
    console.warn('[outbound-invite] member filter failed', e);
  }

  return pending.filter((row) => !memberSet.has(row.inviteeNpub.trim().toLowerCase()));
}

export async function publishOutboundInviteAnnounce(
  parent: Squad,
  inviteId: string,
  inviteeNpub: string
): Promise<boolean> {
  const announcements = getAnnouncementsChannel(parent);
  const gid = announcements.groupId?.trim();
  if (!gid) return false;
  const payload: SquadOutboundInvitePayload = {
    parent_id: gid,
    invite_id: inviteId,
    invitee_npub: inviteeNpub.trim(),
    squad_name: parent.name,
  };
  rememberOutboundInvite(payload);
  const json = formatSquadOutboundInvite(payload);
  const ok = await sendDmMessage(gid, json, '', { virtualBucket: 'announcements' });
  if (ok) {
    void import('../../stores/squad-outbound-invites').then(({ syncOutboundInvitesForSquad }) => {
      void syncOutboundInvitesForSquad(gid);
    });
  }
  return ok;
}

/** Cancel a pending outbound invite; admitters ignore later Accept for this invite_id. */
export async function revokeOutboundInviteAnnounce(
  parent: Squad,
  inviteId: string,
  inviteeNpub: string
): Promise<boolean> {
  const announcements = getAnnouncementsChannel(parent);
  const gid = announcements.groupId?.trim();
  if (!gid) return false;
  const payload: SquadOutboundInviteRevokedPayload = {
    parent_id: gid,
    invite_id: inviteId.trim(),
    invitee_npub: inviteeNpub.trim(),
  };
  rememberOutboundInviteRevoked(payload);
  const json = formatSquadOutboundInviteRevoked(payload);
  const ok = await sendDmMessage(gid, json, '', { virtualBucket: 'announcements' });
  if (ok) {
    void import('../../stores/squad-outbound-invites').then(({ removePendingOutboundInvite }) => {
      removePendingOutboundInvite(gid, inviteId);
    });
  }
  return ok;
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

/**
 * Peer received invitee accept claim (DM) or admit_needed (MLS): run admit.
 * Claims require a matching outbound invite announcement.
 */
export async function handleInviteeConsentForAdmit(
  payload: { parent_id: string; invite_id: string; invitee_npub: string },
  opts?: { broadcastAdmitNeeded?: boolean },
): Promise<void> {
  const me = get(currentUser)?.npub?.trim();
  if (!me) return;
  if (payload.invitee_npub === me) return;

  const key = acceptHandleKey(payload.invite_id, payload.invitee_npub);
  if (admittedSuccessKeys.has(key) || attemptedAdmitKeys.has(key)) return;

  const parent =
    get(squads).find((s) => s.id === payload.parent_id) ??
    get(squads).find((s) => getAnnouncementsChannel(s).groupId === payload.parent_id);
  if (!parent) return;

  if (isOutboundInviteRevoked(payload.parent_id, payload.invite_id)) {
    console.warn('[outbound-invite] ignoring accept for revoked invite', payload.invite_id);
    return;
  }

  const known = await ensureOutboundInviteKnown(payload);
  if (!known) {
    console.warn('[outbound-invite] ignoring unvalidated accept claim', payload.invite_id);
    return;
  }

  attemptedAdmitKeys.add(key);
  pruneHandled();
  try {
    const result = await admitMemberToSquad({ parent, memberNpub: payload.invitee_npub });
    if (result.ok) {
      admittedSuccessKeys.add(key);
      pruneHandled();
      clearPendingAdmitForMember(payload.parent_id, payload.invitee_npub);
      pendingOutboundInvites.delete(inviteMemoryKey(payload.parent_id, payload.invite_id));
      void import('../../stores/squad-outbound-invites').then(({ removePendingOutboundInvite }) => {
        removePendingOutboundInvite(payload.parent_id, payload.invite_id);
      });
    } else {
      enqueuePendingAdmit({
        kind: 'invite',
        parentId: payload.parent_id,
        memberNpub: payload.invitee_npub,
        inviteId: payload.invite_id,
        lastError: result.error,
        lastAttemptAt: Date.now(),
      });
    }

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
  } catch (e) {
    enqueuePendingAdmit({
      kind: 'invite',
      parentId: payload.parent_id,
      memberNpub: payload.invitee_npub,
      inviteId: payload.invite_id,
      lastError: e instanceof Error ? e.message : String(e),
      lastAttemptAt: Date.now(),
    });
  }
}

export function onMlsOutboundInviteAnnounce(content: string): void {
  const parsed = parseSquadOutboundInvite(content);
  if (parsed) rememberOutboundInvite(parsed);
}

export function onMlsOutboundInviteRevoked(content: string): void {
  const parsed = parseSquadOutboundInviteRevoked(content);
  if (parsed) rememberOutboundInviteRevoked(parsed);
}

export function onMlsAdmitNeeded(content: string, groupId: string): void {
  const parsed = parseSquadAdmitNeeded(content);
  if (!parsed) return;
  if (parsed.parent_id !== groupId.trim()) return;
  void handleInviteeConsentForAdmit(parsed, { broadcastAdmitNeeded: false }).catch((e) =>
    console.warn('[outbound-invite] admit_needed failed', e)
  );
}
