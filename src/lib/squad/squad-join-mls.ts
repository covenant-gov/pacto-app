import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { sendDmMessage, getDmMessages, getMlsGroupMembers } from '../api/nostr';
import { currentUser } from '../../stores/auth';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import type { CommonsJoinRequestDto, CommonsJoinRequestStatus } from '../commons/types';
import { isJoinRequesterMuted } from './squad-join-spam';

export const SQUAD_BOT_JOIN_DM_SCHEMA = 'pacto.squad.bot_join_dm.v1';
export const SQUAD_BOT_JOIN_RESPONSE_DM_SCHEMA = 'pacto.squad.bot_join_response.v1';
export const SQUAD_JOIN_REQUEST_SCHEMA = 'pacto.squad.join_request.v1';
export const SQUAD_JOIN_REQUEST_RESPONSE_SCHEMA = 'pacto.squad.join_request_response.v1';

export interface SquadBotJoinDmDto {
  requestId: string;
  squadId: string;
  squadName: string;
  broadcastEventId: string;
  requesterNpub: string;
  createdAt: number;
}

export function formatBotJoinDm(input: {
  squadId: string;
  squadName: string;
  broadcastEventId: string;
}): string {
  return JSON.stringify({
    schema: SQUAD_BOT_JOIN_DM_SCHEMA,
    squadId: input.squadId.trim(),
    squadName: input.squadName.trim(),
    broadcastEventId: input.broadcastEventId.trim(),
  });
}

/** Private DM from operator to requester after accept/reject. */
export function formatJoinResponseDm(input: {
  squadId: string;
  squadName: string;
  requestId: string;
  status: 'accepted' | 'rejected';
}): string {
  return JSON.stringify({
    schema: SQUAD_BOT_JOIN_RESPONSE_DM_SCHEMA,
    squadId: input.squadId.trim(),
    squadName: input.squadName.trim(),
    requestId: input.requestId.trim(),
    status: input.status,
  });
}

export function formatMlsJoinRequest(input: {
  requestId: string;
  squadId: string;
  squadName: string;
  broadcastEventId: string;
  requesterNpub: string;
  createdAt: number;
  forwardedByNpub: string;
}): string {
  return JSON.stringify({
    schema: SQUAD_JOIN_REQUEST_SCHEMA,
    pacto_virtual_bucket: 'join_requests',
    requestId: input.requestId,
    squadId: input.squadId,
    squadName: input.squadName,
    broadcastEventId: input.broadcastEventId,
    requesterNpub: input.requesterNpub,
    status: 'pending',
    createdAt: input.createdAt,
    forwardedByNpub: input.forwardedByNpub,
  });
}

export function formatMlsJoinRequestResponse(input: {
  requestId: string;
  squadId: string;
  status: 'accepted' | 'rejected';
  responderNpub: string;
  respondedAt: number;
}): string {
  return JSON.stringify({
    schema: SQUAD_JOIN_REQUEST_RESPONSE_SCHEMA,
    pacto_virtual_bucket: 'join_requests',
    requestId: input.requestId,
    squadId: input.squadId,
    status: input.status,
    responderNpub: input.responderNpub,
    respondedAt: input.respondedAt,
  });
}

type JoinRequestWire = {
  schema?: string;
  requestId?: string;
  squadId?: string;
  squadName?: string;
  broadcastEventId?: string;
  requesterNpub?: string;
  status?: string;
  createdAt?: number;
  forwardedByNpub?: string;
  responderNpub?: string;
  respondedAt?: number;
};

function parseJoinWire(content: string | null | undefined): JoinRequestWire | null {
  const trimmed = content?.trim() ?? '';
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed) as JoinRequestWire;
  } catch {
    return null;
  }
}

/** Merge MLS join_requests timeline into pending DTOs (first response wins). */
export function mergeJoinRequestsFromMlsMessages(
  messages: Array<{ id?: string; content?: string | null; at?: number; npub?: string }>
): CommonsJoinRequestDto[] {
  const byId = new Map<string, CommonsJoinRequestDto>();
  const responses = new Map<
    string,
    { status: CommonsJoinRequestStatus; responderNpub?: string; respondedAt?: number }
  >();

  const sorted = [...messages].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  for (const msg of sorted) {
    const wire = parseJoinWire(msg.content);
    if (!wire?.schema || !wire.requestId) continue;
    if (wire.schema === SQUAD_JOIN_REQUEST_RESPONSE_SCHEMA) {
      if (responses.has(wire.requestId)) continue;
      const status =
        wire.status === 'accepted' || wire.status === 'rejected' ? wire.status : null;
      if (!status) continue;
      responses.set(wire.requestId, {
        status,
        responderNpub: wire.responderNpub,
        respondedAt: wire.respondedAt,
      });
      continue;
    }
    if (wire.schema !== SQUAD_JOIN_REQUEST_SCHEMA) continue;
    if (byId.has(wire.requestId)) continue;
    if (!wire.squadId || !wire.requesterNpub) continue;
    byId.set(wire.requestId, {
      eventId: wire.requestId,
      requesterNpub: wire.requesterNpub,
      squadId: wire.squadId,
      squadName: wire.squadName ?? 'Squad',
      broadcastEventId: wire.broadcastEventId ?? '',
      createdAt: wire.createdAt ?? msg.at ?? 0,
      status: 'pending',
    });
  }

  for (const [id, resp] of responses) {
    const row = byId.get(id);
    if (!row) continue;
    row.status = resp.status;
    row.responderNpub = resp.responderNpub;
    row.respondedAt = resp.respondedAt;
  }

  return [...byId.values()]
    .filter((r) => r.status === 'pending')
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function syncBotJoinDms(squadId: string): Promise<SquadBotJoinDmDto[]> {
  return invoke<SquadBotJoinDmDto[]>('squad_bot_sync_join_dms', { squadId: squadId.trim() });
}

/** Non-holders lack bot secret — bot inbox sync is expected to fail for them. */
export function isExpectedNonHolderBotSyncError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('holder') ||
    lower.includes('bot secret') ||
    lower.includes('not initialized') ||
    lower.includes('stale')
  );
}

/** Holder: unwrap bot DMs and fan out missing requests into MLS join_requests. */
export async function fanOutBotJoinDmsToMls(squadId: string): Promise<number> {
  const id = squadId.trim();
  if (!id) return 0;
  const me = get(currentUser)?.npub;
  if (!me) return 0;

  let dms: SquadBotJoinDmDto[];
  try {
    dms = await syncBotJoinDms(id);
  } catch (e) {
    const message = getInvokeErrorMessage(e, 'Could not sync bot inbox.');
    if (isExpectedNonHolderBotSyncError(message)) return 0;
    throw new Error(message, { cause: e });
  }
  if (dms.length === 0) return 0;

  const existing = await loadPendingJoinRequestsFromMls(id);
  const known = new Set(existing.map((r) => r.eventId));
  const knownRequesters = new Set(existing.map((r) => r.requesterNpub));
  const allMsgs = await getDmMessages(id, 200, 0, { virtualBucketFilter: 'join_requests' });
  for (const m of allMsgs) {
    const wire = parseJoinWire(m.content);
    if (wire?.requestId) known.add(wire.requestId);
    if (wire?.schema === SQUAD_JOIN_REQUEST_SCHEMA && wire.requesterNpub) {
      knownRequesters.add(wire.requesterNpub);
    }
  }

  let memberSet = new Set<string>();
  try {
    const members = await getMlsGroupMembers(id);
    memberSet = new Set(members.members ?? []);
  } catch {
    // membership unknown — still fan out; accept path will fail closed for members
  }

  const sortedDms = [...dms].sort((a, b) => b.createdAt - a.createdAt);
  const seenRequestersThisSync = new Set<string>();

  let forwarded = 0;
  for (const dm of sortedDms) {
    if (known.has(dm.requestId)) continue;
    if (memberSet.has(dm.requesterNpub)) continue;
    if (isJoinRequesterMuted(id, dm.requesterNpub)) continue;
    if (knownRequesters.has(dm.requesterNpub)) continue;
    if (seenRequestersThisSync.has(dm.requesterNpub)) continue;
    const content = formatMlsJoinRequest({
      requestId: dm.requestId,
      squadId: dm.squadId,
      squadName: dm.squadName,
      broadcastEventId: dm.broadcastEventId,
      requesterNpub: dm.requesterNpub,
      createdAt: dm.createdAt,
      forwardedByNpub: me,
    });
    try {
      await sendDmMessage(id, content, '', { virtualBucket: 'join_requests' });
      known.add(dm.requestId);
      knownRequesters.add(dm.requesterNpub);
      seenRequestersThisSync.add(dm.requesterNpub);
      forwarded += 1;
    } catch (e) {
      console.warn('[squad-join] MLS fan-out failed', e);
    }
  }
  return forwarded;
}

export async function loadPendingJoinRequestsFromMls(
  squadId: string
): Promise<CommonsJoinRequestDto[]> {
  const id = squadId.trim();
  if (!id) return [];
  const msgs = await getDmMessages(id, 200, 0, { virtualBucketFilter: 'join_requests' });
  return mergeJoinRequestsFromMlsMessages(
    msgs.map((m) => ({
      id: m.id,
      content: m.content,
      at: m.at,
      npub: m.npub,
    }))
  ).filter((r) => !isJoinRequesterMuted(id, r.requesterNpub));
}

export async function respondToMlsJoinRequest(input: {
  requestId: string;
  squadId: string;
  status: 'accepted' | 'rejected';
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = get(currentUser)?.npub;
  if (!me) return { ok: false, error: 'Not signed in.' };
  const pending = await loadPendingJoinRequestsFromMls(input.squadId);
  const row = pending.find((r) => r.eventId === input.requestId);
  if (!row) {
    return { ok: false, error: 'Join request is no longer pending.' };
  }
  const content = formatMlsJoinRequestResponse({
    requestId: input.requestId,
    squadId: input.squadId,
    status: input.status,
    responderNpub: me,
    respondedAt: Math.floor(Date.now() / 1000),
  });
  try {
    await sendDmMessage(input.squadId, content, '', { virtualBucket: 'join_requests' });
    void notifyJoinRequesterViaDm({
      requesterNpub: row.requesterNpub,
      squadId: row.squadId,
      squadName: row.squadName,
      requestId: input.requestId,
      status: input.status,
    }).catch((e) => console.warn('[squad-join] requester notify DM failed', e));
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: getInvokeErrorMessage(e, 'Could not update join request.') };
  }
}

async function notifyJoinRequesterViaDm(input: {
  requesterNpub: string;
  squadId: string;
  squadName: string;
  requestId: string;
  status: 'accepted' | 'rejected';
}): Promise<void> {
  const npub = input.requesterNpub.trim();
  if (!npub.startsWith('npub1')) return;
  const content = formatJoinResponseDm({
    squadId: input.squadId,
    squadName: input.squadName,
    requestId: input.requestId,
    status: input.status,
  });
  await sendDmMessage(npub, content);
}
