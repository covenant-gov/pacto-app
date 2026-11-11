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
export const SQUAD_OUTBOUND_INVITE_DECLINED_TYPE = 'squad_outbound_invite_declined';
export const SQUAD_INVITE_ACCEPTED_TYPE = 'squad_invite_accepted';
export const SQUAD_INVITE_DECLINED_TYPE = 'squad_invite_declined';
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

export type SquadInviteDeclinedPayload = SquadInviteAcceptedPayload;
export type SquadOutboundInviteDeclinedPayload = SquadOutboundInviteRevokedPayload;

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

/** Parse a `{ type, payload }` envelope whose payload names an invite; `squad_name` defaults to ''. */
function parseInviteEnvelope(
  content: string | null | undefined,
  type: string
): SquadOutboundInvitePayload | null {
  if (!content?.trim().startsWith('{')) return null;
  try {
    const root = JSON.parse(content) as Record<string, unknown>;
    if (root.type !== type) return null;
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

/** Same as `parseInviteEnvelope`, without `squad_name`. */
function parseInviteIdentityEnvelope(
  content: string | null | undefined,
  type: string
): SquadOutboundInviteRevokedPayload | null {
  const parsed = parseInviteEnvelope(content, type);
  if (!parsed) return null;
  return { parent_id: parsed.parent_id, invite_id: parsed.invite_id, invitee_npub: parsed.invitee_npub };
}

export function parseSquadOutboundInvite(content: string | null | undefined): SquadOutboundInvitePayload | null {
  return parseInviteEnvelope(content, SQUAD_OUTBOUND_INVITE_TYPE);
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
  return parseInviteIdentityEnvelope(content, SQUAD_OUTBOUND_INVITE_REVOKED_TYPE);
}

export function formatSquadOutboundInviteDeclined(payload: SquadOutboundInviteDeclinedPayload): string {
  return JSON.stringify({
    type: SQUAD_OUTBOUND_INVITE_DECLINED_TYPE,
    payload,
    pacto_virtual_bucket: 'announcements',
  });
}

export function parseSquadOutboundInviteDeclined(
  content: string | null | undefined
): SquadOutboundInviteDeclinedPayload | null {
  return parseInviteIdentityEnvelope(content, SQUAD_OUTBOUND_INVITE_DECLINED_TYPE);
}

export function formatSquadInviteAccepted(payload: SquadInviteAcceptedPayload): string {
  return JSON.stringify({ type: SQUAD_INVITE_ACCEPTED_TYPE, payload });
}

export function formatSquadInviteDeclined(payload: SquadInviteDeclinedPayload): string {
  return JSON.stringify({ type: SQUAD_INVITE_DECLINED_TYPE, payload });
}

export function parseSquadInviteDeclined(content: string | null | undefined): SquadInviteDeclinedPayload | null {
  return parseInviteEnvelope(content, SQUAD_INVITE_DECLINED_TYPE);
}

export function parseSquadInviteAccepted(content: string | null | undefined): SquadInviteAcceptedPayload | null {
  return parseInviteEnvelope(content, SQUAD_INVITE_ACCEPTED_TYPE);
}

export function formatSquadAdmitNeeded(payload: SquadAdmitNeededPayload): string {
  return JSON.stringify({
    type: SQUAD_ADMIT_NEEDED_TYPE,
    payload,
    pacto_virtual_bucket: 'announcements',
  });
}

export function parseSquadAdmitNeeded(content: string | null | undefined): SquadAdmitNeededPayload | null {
  return parseInviteIdentityEnvelope(content, SQUAD_ADMIT_NEEDED_TYPE);
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

let privilegeEnforceModule: Promise<typeof import('../governance/squad-privilege-enforce')> | undefined;

function loadPrivilegeEnforce() {
  privilegeEnforceModule ??= import('../governance/squad-privilege-enforce');
  return privilegeEnforceModule;
}

type AuthoredAnnouncementMessage = { content: string; at: number; author?: string };

function isOutboundInviteLifecycleContent(content: string): boolean {
  return Boolean(
    parseSquadOutboundInvite(content) ||
      parseSquadOutboundInviteRevoked(content) ||
      parseSquadOutboundInviteDeclined(content)
  );
}

/** Drop invite/revoke/decline rows whose author lacks `inviteAccept` (same gate as live MLS events). */
async function filterAuthorizedOutboundInviteMessages(
  parentId: string,
  msgs: AuthoredAnnouncementMessage[]
): Promise<{ content: string; at: number }[]> {
  const { decideSquadPrivilege } = await loadPrivilegeEnforce();
  const verdicts = new Map<string, Promise<boolean>>();
  const authorAllowed = (author: string): Promise<boolean> => {
    let verdict = verdicts.get(author);
    if (!verdict) {
      verdict = decideSquadPrivilege({
        parentId,
        memberNpub: author || '__missing__',
        action: 'inviteAccept',
      }).then((d) => d.ok);
      verdicts.set(author, verdict);
    }
    return verdict;
  };
  const out: { content: string; at: number }[] = [];
  for (const m of msgs) {
    if (isOutboundInviteLifecycleContent(m.content) && !(await authorAllowed(m.author?.trim() ?? ''))) {
      continue;
    }
    out.push({ content: m.content, at: m.at });
  }
  return out;
}

/** Announcements history for a squad, with lifecycle rows filtered by author privilege. */
async function loadAuthorizedAnnouncementMessages(
  gid: string
): Promise<{ content: string; at: number }[]> {
  const me = get(currentUser)?.npub?.trim();
  const collected: AuthoredAnnouncementMessage[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const msgs = await getDmMessages(gid, pageSize, offset, {
      virtualBucketFilter: 'announcements',
    });
    for (const m of msgs) {
      collected.push({ content: m.content, at: m.at, author: m.mine ? me : m.npub });
    }
    if (msgs.length < pageSize) break;
  }
  return filterAuthorizedOutboundInviteMessages(gid, collected);
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
    // Side-effect: remember invites/revokes with latest-wins.
    mergePendingOutboundInvitesFromMlsMessages(await loadAuthorizedAnnouncementMessages(gid));
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
    const closed =
      parseSquadOutboundInviteRevoked(m.content) ?? parseSquadOutboundInviteDeclined(m.content);
    if (closed) {
      rememberOutboundInviteRevoked(closed);
      byInviteId.set(closed.invite_id, { kind: 'revoke', at: m.at, payload: closed });
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

  let collected: { content: string; at: number }[];
  try {
    collected = await loadAuthorizedAnnouncementMessages(gid);
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

async function publishInviteClaimDms(
  body: string,
  opts: { inviteeNpub: string; admitterNpubs: string[] },
  warnLabel: string,
): Promise<void> {
  const targets = [...new Set(opts.admitterNpubs.map((n) => n.trim()).filter(Boolean))];
  await Promise.allSettled(
    targets
      .filter((npub) => npub !== opts.inviteeNpub)
      .map(async (npub) => {
        try {
          await sendDmMessage(npub, body);
        } catch (e) {
          console.warn(`[outbound-invite] ${warnLabel} claim DM failed`, npub.slice(0, 16), e);
        }
      }),
  );
}

export async function publishInviteAcceptedClaims(opts: {
  parentId: string;
  inviteId: string;
  inviteeNpub: string;
  squadName: string;
  admitterNpubs: string[];
}): Promise<void> {
  await publishInviteClaimDms(
    formatSquadInviteAccepted({
      parent_id: opts.parentId,
      invite_id: opts.inviteId,
      invitee_npub: opts.inviteeNpub,
      squad_name: opts.squadName,
    }),
    opts,
    'accept',
  );
}

export async function publishInviteDeclinedClaims(opts: {
  parentId: string;
  inviteId: string;
  inviteeNpub: string;
  squadName: string;
  admitterNpubs: string[];
}): Promise<void> {
  await publishInviteClaimDms(
    formatSquadInviteDeclined({
      parent_id: opts.parentId,
      invite_id: opts.inviteId,
      invitee_npub: opts.inviteeNpub,
      squad_name: opts.squadName,
    }),
    opts,
    'decline',
  );
}

/** Cancel a pending outbound invite via invitee decline; same closed set as admin revoke. */
export async function publishOutboundInviteDeclinedAnnounce(
  parent: Squad,
  inviteId: string,
  inviteeNpub: string
): Promise<boolean> {
  const announcements = getAnnouncementsChannel(parent);
  const gid = announcements.groupId?.trim();
  if (!gid) return false;
  const payload: SquadOutboundInviteDeclinedPayload = {
    parent_id: gid,
    invite_id: inviteId.trim(),
    invitee_npub: inviteeNpub.trim(),
  };
  rememberOutboundInviteRevoked(payload);
  const json = formatSquadOutboundInviteDeclined(payload);
  const ok = await sendDmMessage(gid, json, '', { virtualBucket: 'announcements' });
  if (ok) {
    void import('../../stores/squad-outbound-invites').then(({ removePendingOutboundInvite }) => {
      removePendingOutboundInvite(gid, inviteId);
    });
  }
  return ok;
}

const PARENT_SQUAD_WAIT_MS = 10_000;

function findParentSquad(parentId: string): Squad | undefined {
  return (
    get(squads).find((s) => s.id === parentId) ??
    get(squads).find((s) => getAnnouncementsChannel(s).groupId === parentId)
  );
}

/** Resolve the squad, waiting briefly for store hydration after login. */
function waitForParentSquad(parentId: string): Promise<Squad | undefined> {
  const found = findParentSquad(parentId);
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    let ready = false;
    let done = false;
    const finish = (squad?: Squad) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      resolve(squad);
    };
    const timer = setTimeout(() => finish(undefined), PARENT_SQUAD_WAIT_MS);
    const unsub = squads.subscribe(() => {
      if (!ready) return;
      const squad = findParentSquad(parentId);
      if (squad) finish(squad);
    });
    ready = true;
  });
}

/**
 * Admitter received invitee decline claim (DM): close the invite on announcements.
 * Sender must be the invitee, local user needs `inviteAccept`, and the claim needs a
 * matching outbound invite announcement.
 */
export async function handleInviteeDeclineForAnnounce(
  payload: { parent_id: string; invite_id: string; invitee_npub: string },
  senderNpub: string,
): Promise<void> {
  if (senderNpub.trim().toLowerCase() !== payload.invitee_npub.trim().toLowerCase()) {
    console.warn('[outbound-invite] ignoring decline with mismatched sender', payload.invite_id);
    return;
  }
  const me = get(currentUser)?.npub?.trim();
  if (!me) return;
  if (payload.invitee_npub.trim().toLowerCase() === me.toLowerCase()) return;

  if (isOutboundInviteRevoked(payload.parent_id, payload.invite_id)) return;
  if (admittedSuccessKeys.has(acceptHandleKey(payload.invite_id, payload.invitee_npub))) return;

  const parent = await waitForParentSquad(payload.parent_id);
  if (!parent) return;

  const { requireMySquadPrivilege } = await loadPrivilegeEnforce();
  const privilege = await requireMySquadPrivilege(payload.parent_id, 'inviteAccept');
  if (!privilege.ok) return;

  const known = await ensureOutboundInviteKnown(payload);
  if (!known) {
    console.warn('[outbound-invite] ignoring unvalidated decline claim', payload.invite_id);
    return;
  }

  // Another admitter may have announced while awaiting above.
  if (isOutboundInviteRevoked(payload.parent_id, payload.invite_id)) return;

  await publishOutboundInviteDeclinedAnnounce(parent, payload.invite_id, payload.invitee_npub);
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

export function onMlsOutboundInviteDeclined(content: string): void {
  const parsed = parseSquadOutboundInviteDeclined(content);
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
