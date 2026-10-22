/**
 * After a storage wipe, ask an online member to restore squads still visible in
 * recovered invite DMs, then auto-accept only those welcomes.
 */

import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import {
  acceptMlsWelcome,
  getMlsGroupMembers,
  getMlsGroupMetadata,
  listPendingMlsWelcomes,
  parseChannelInSquadMessage,
  parseSquadInviteMessage,
  sendDmMessage,
} from '../api/nostr';
import { finalizeSquadAfterAnnouncementsWelcome, acceptStagedChannelWelcome } from '../invites/accept-invite';
import { sameMlsGroupId } from '../invites/declined-welcomes';
import { recoverMissingSquadCatalog } from './squad-catalog-recover';
import { restoreMemberToSquad } from '../parent/restore-squad-access';
import { getAnnouncementsChannel } from '../parent-navbar';
import { persistenceKey } from '../../stores/persistence-context';
import { backendDmMessages } from '../../stores/dm';
import { currentUser } from '../../stores/auth-session';
import { squads, type Squad } from '../../stores/squads';
import { showToast } from '../../stores/toast';
import { dmError } from '../utils/dm-debug';

export const SQUAD_REJOIN_REQUEST_TYPE = 'squad_rejoin_request';
export const SQUAD_REJOIN_NEEDED_TYPE = 'squad_rejoin_needed';
export const SQUAD_REJOIN_PENDING_PREFIX = 'pacto_squad_rejoin_pending';
export const SQUAD_REJOIN_FANOUT_PREFIX = 'pacto_squad_rejoin_fanout';

const REQUEST_COOLDOWN_MS = 15_000;
const RETRY_INTERVAL_MS = 45_000;

export interface SquadRejoinPayload {
  parent_id: string;
  requester_npub: string;
  request_id: string;
}

export interface PlannedRejoin {
  parentId: string;
  squadName: string;
  targets: string[];
  channelGroupIds: string[];
}

interface PendingRejoin extends PlannedRejoin {
  requestId: string;
  lastAttemptAt: number;
}

const toastedParents = new Set<string>();
const acceptingParents = new Set<string>();
let retryTimer: ReturnType<typeof setInterval> | null = null;

function npubOk(value: string): boolean {
  return value.startsWith('npub1');
}

function parseRejoin(content: string | null | undefined, type: string): SquadRejoinPayload | null {
  if (!content?.trim().startsWith('{')) return null;
  try {
    const root = JSON.parse(content) as Record<string, unknown>;
    if (root.type !== type) return null;
    const p = root.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') return null;
    const parent_id = typeof p.parent_id === 'string' ? p.parent_id.trim() : '';
    const requester_npub = typeof p.requester_npub === 'string' ? p.requester_npub.trim() : '';
    const request_id = typeof p.request_id === 'string' ? p.request_id.trim() : '';
    if (!parent_id || !npubOk(requester_npub) || !request_id) return null;
    return { parent_id, requester_npub, request_id };
  } catch {
    return null;
  }
}

export function parseSquadRejoinRequest(content: string | null | undefined): SquadRejoinPayload | null {
  return parseRejoin(content, SQUAD_REJOIN_REQUEST_TYPE);
}

export function parseSquadRejoinNeeded(content: string | null | undefined): SquadRejoinPayload | null {
  return parseRejoin(content, SQUAD_REJOIN_NEEDED_TYPE);
}

export function formatSquadRejoinRequest(payload: SquadRejoinPayload): string {
  return JSON.stringify({ type: SQUAD_REJOIN_REQUEST_TYPE, payload });
}

export function formatSquadRejoinNeeded(payload: SquadRejoinPayload): string {
  return JSON.stringify({
    type: SQUAD_REJOIN_NEEDED_TYPE,
    payload,
    pacto_virtual_bucket: 'announcements',
  });
}

function addTarget(targets: Set<string>, npub: string, selfNpub: string): void {
  const n = npub.trim();
  if (!npubOk(n) || sameMlsGroupId(n, selfNpub)) return;
  targets.add(n);
}

/** Squads named by recovered invite DMs that this install has not joined. */
export function planSquadRejoinRequests(opts: {
  threads: Array<{ peerNpub: string; messages: Array<{ content?: string }> }>;
  localGroupIds: Iterable<string>;
  selfNpub: string;
}): PlannedRejoin[] {
  const local = new Set(
    [...opts.localGroupIds].map((id) => id.trim().toLowerCase()).filter((id) => id.length > 0),
  );
  const byParent = new Map<
    string,
    { parentId: string; squadName: string; targets: Set<string>; channels: Set<string> }
  >();

  function slot(parentId: string, squadName: string) {
    const id = parentId.trim();
    const key = id.toLowerCase();
    let row = byParent.get(key);
    if (!row) {
      row = { parentId: id, squadName: squadName.trim(), targets: new Set(), channels: new Set() };
      byParent.set(key, row);
    } else if (!row.squadName && squadName.trim()) {
      row.squadName = squadName.trim();
    }
    return row;
  }

  for (const thread of opts.threads) {
    for (const msg of thread.messages) {
      const invite = parseSquadInviteMessage(msg.content ?? '');
      if (invite?.groupId) {
        const row = slot(invite.groupId, invite.squadName);
        const admitters = invite.admitterNpubs ?? [];
        if (admitters.length > 0) {
          for (const npub of admitters) addTarget(row.targets, npub, opts.selfNpub);
        } else {
          addTarget(row.targets, thread.peerNpub, opts.selfNpub);
        }
      }
      const channel = parseChannelInSquadMessage(msg.content ?? '');
      if (channel?.announcementsGroupId) {
        const row = slot(channel.announcementsGroupId, channel.squadName);
        addTarget(row.targets, thread.peerNpub, opts.selfNpub);
        const channelId = channel.channelGroupId.trim();
        if (channelId) row.channels.add(channelId);
      }
    }
  }

  const planned: PlannedRejoin[] = [];
  for (const row of byParent.values()) {
    if (local.has(row.parentId.toLowerCase())) continue;
    if (row.targets.size === 0) continue;
    planned.push({
      parentId: row.parentId,
      squadName: row.squadName || row.parentId,
      targets: [...row.targets],
      channelGroupIds: [...row.channels],
    });
  }
  return planned;
}

function readPending(): PendingRejoin[] {
  if (typeof localStorage === 'undefined') return [];
  const key = persistenceKey(SQUAD_REJOIN_PENDING_PREFIX);
  if (!key) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is PendingRejoin => {
      if (!row || typeof row !== 'object') return false;
      const r = row as PendingRejoin;
      return typeof r.parentId === 'string' && typeof r.requestId === 'string' && Array.isArray(r.targets);
    });
  } catch {
    return [];
  }
}

function writePending(rows: PendingRejoin[]): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(SQUAD_REJOIN_PENDING_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(rows.slice(0, 50)));
  } catch {
    /* quota */
  }
}

function readFanout(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  const key = persistenceKey(SQUAD_REJOIN_FANOUT_PREFIX);
  if (!key) return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function writeFanout(keys: Set<string>): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(SQUAD_REJOIN_FANOUT_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify([...keys].slice(0, 100)));
  } catch {
    /* quota */
  }
}

function newRequestId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `rejoin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureRetryTimer(): void {
  if (retryTimer || readPending().length === 0) return;
  retryTimer = setInterval(() => {
    void scanSquadRejoinAfterBackfill();
  }, RETRY_INTERVAL_MS);
}

function stopRetryTimerIfIdle(): void {
  if (readPending().length > 0 || !retryTimer) return;
  clearInterval(retryTimer);
  retryTimer = null;
}

function toastRestoring(parentId: string): void {
  const key = parentId.toLowerCase();
  if (toastedParents.has(key)) return;
  toastedParents.add(key);
  try {
    showToast(get(t)('messaging.channel.mlsRejoinRestoring'));
  } catch {
    showToast('Restoring squad access…');
  }
}

function mergePending(planned: PlannedRejoin[], existing: PendingRejoin[]): PendingRejoin[] {
  return planned.map((row) => {
    const prev = existing.find((p) => sameMlsGroupId(p.parentId, row.parentId));
    const channels = new Set([...(prev?.channelGroupIds ?? []), ...row.channelGroupIds]);
    return {
      ...row,
      channelGroupIds: [...channels],
      requestId: prev?.requestId || newRequestId(),
      lastAttemptAt: prev?.lastAttemptAt ?? 0,
    };
  });
}

async function sendDueRequests(rows: PendingRejoin[]): Promise<PendingRejoin[]> {
  const now = Date.now();
  const me = get(currentUser)?.npub?.trim() ?? '';
  const next: PendingRejoin[] = [];
  for (const row of rows) {
    if (now - row.lastAttemptAt < REQUEST_COOLDOWN_MS) {
      next.push(row);
      continue;
    }
    const body = formatSquadRejoinRequest({
      parent_id: row.parentId,
      requester_npub: me,
      request_id: row.requestId,
    });
    let sent = false;
    for (const target of row.targets) {
      try {
        await sendDmMessage(target, body);
        sent = true;
      } catch (e) {
        console.warn('[squad-rejoin] request DM failed', target.slice(0, 16), e);
      }
    }
    if (sent) toastRestoring(row.parentId);
    next.push({ ...row, lastAttemptAt: sent ? now : row.lastAttemptAt });
  }
  return next;
}

/** Accept welcomes for squads this install asked to rejoin. */
export async function tryAcceptRememberedRejoinWelcomes(groupId?: string | null): Promise<void> {
  const focus = groupId?.trim() ?? '';
  let rows = readPending();
  if (focus) {
    rows = rows.filter(
      (row) =>
        sameMlsGroupId(row.parentId, focus) ||
        row.channelGroupIds.some((id) => sameMlsGroupId(id, focus)),
    );
  }
  if (rows.length === 0) return;

  let welcomes;
  try {
    welcomes = await listPendingMlsWelcomes();
  } catch (e) {
    dmError('list welcomes for squad rejoin', e);
    return;
  }

  for (const row of rows) {
    const lock = row.parentId.toLowerCase();
    if (acceptingParents.has(lock)) continue;
    acceptingParents.add(lock);
    try {
      const ann = welcomes.find((w) => sameMlsGroupId(w.nostr_group_id, row.parentId));
      let joinedAnnouncements = false;
      if (ann?.id) {
        await acceptMlsWelcome(ann.id);
        await finalizeSquadAfterAnnouncementsWelcome(
          { groupId: row.parentId, name: row.squadName || row.parentId },
          null,
        );
        await recoverMissingSquadCatalog();
        joinedAnnouncements = true;
      }
      const parentReady =
        joinedAnnouncements ||
        get(squads).some((s) => sameMlsGroupId(s.id, row.parentId));
      if (!parentReady) continue;
      for (const channelId of row.channelGroupIds) {
        const welcome = welcomes.find((w) => sameMlsGroupId(w.nostr_group_id, channelId));
        if (!welcome?.id) continue;
        const hinted = parseChannelName(row, channelId);
        await acceptStagedChannelWelcome({
          welcomeId: welcome.id,
          channelGroupId: welcome.nostr_group_id,
          parentId: row.parentId,
          channelName: hinted,
        });
      }
    } catch (e) {
      dmError('accept squad rejoin welcome', e);
    } finally {
      acceptingParents.delete(lock);
    }
  }
}

function parseChannelName(row: PendingRejoin, channelId: string): string {
  for (const thread of Object.values(get(backendDmMessages))) {
    for (const msg of thread) {
      const channel = parseChannelInSquadMessage(msg.content ?? '');
      if (
        channel &&
        sameMlsGroupId(channel.announcementsGroupId, row.parentId) &&
        sameMlsGroupId(channel.channelGroupId, channelId)
      ) {
        return channel.channelName;
      }
    }
  }
  return channelId;
}

function dropJoined(rows: PendingRejoin[], localGroupIds: string[]): PendingRejoin[] {
  return rows.filter((row) => !localGroupIds.some((id) => sameMlsGroupId(id, row.parentId)));
}

/** Scan recovered DMs and ask admitters to restore squads missing locally. */
export async function scanSquadRejoinAfterBackfill(): Promise<void> {
  const me = get(currentUser)?.npub?.trim();
  if (!me) return;
  let localIds: string[];
  try {
    const meta = await getMlsGroupMetadata();
    localIds = meta.map((g) => g.group_id);
  } catch (e) {
    dmError('mls metadata for squad rejoin', e);
    return;
  }
  const threads = Object.entries(get(backendDmMessages)).map(([peerNpub, messages]) => ({
    peerNpub,
    messages,
  }));
  const planned = planSquadRejoinRequests({ threads, localGroupIds: localIds, selfNpub: me });
  const pending = dropJoined(mergePending(planned, readPending()), localIds);
  const sent = await sendDueRequests(pending);
  writePending(sent);
  if (sent.length > 0) ensureRetryTimer();
  else stopRetryTimerIfIdle();
  await tryAcceptRememberedRejoinWelcomes();
  try {
    const meta = await getMlsGroupMetadata();
    const still = dropJoined(readPending(), meta.map((g) => g.group_id));
    writePending(still);
    if (still.length === 0) stopRetryTimerIfIdle();
  } catch {
    /* keep the queue */
  }
}

/** Record a live channel-in-squad DM for a rejoin already in progress. */
export function noteRejoinChannelDm(content: string): void {
  const channel = parseChannelInSquadMessage(content);
  if (!channel?.announcementsGroupId || !channel.channelGroupId) return;
  const rows = readPending();
  const row = rows.find((r) => sameMlsGroupId(r.parentId, channel.announcementsGroupId));
  if (!row) return;
  if (!row.channelGroupIds.some((id) => sameMlsGroupId(id, channel.channelGroupId))) {
    row.channelGroupIds.push(channel.channelGroupId);
    writePending(rows);
  }
  void tryAcceptRememberedRejoinWelcomes(channel.channelGroupId);
}

function findSquad(parentId: string): Squad | undefined {
  return get(squads).find(
    (s) =>
      sameMlsGroupId(s.id, parentId) ||
      sameMlsGroupId(getAnnouncementsChannel(s).groupId, parentId),
  );
}

/**
 * An online member received a rejoin ask.
 * Admins restore the squad. Other members fan the ask out once on announcements.
 * A requester with no leaf is ignored.
 */
export async function handleSquadRejoinRequest(
  payload: SquadRejoinPayload,
  opts: { fanOut: boolean },
): Promise<void> {
  const me = get(currentUser)?.npub?.trim();
  if (!me || sameMlsGroupId(payload.requester_npub, me)) return;
  const parent = findSquad(payload.parent_id);
  if (!parent) return;
  const announcementsGid = getAnnouncementsChannel(parent).groupId?.trim();
  if (!announcementsGid) return;

  let members: string[];
  let admins: string[];
  try {
    const result = await getMlsGroupMembers(announcementsGid);
    members = result.members ?? [];
    admins = result.admins ?? [];
  } catch (e) {
    dmError('members for squad rejoin', e);
    return;
  }
  if (!members.some((n) => sameMlsGroupId(n, payload.requester_npub))) return;
  const iAmAdmin = admins.some((n) => sameMlsGroupId(n, me));
  const iAmMember = members.some((n) => sameMlsGroupId(n, me));
  if (!iAmAdmin && !iAmMember) return;

  if (iAmAdmin) {
    await restoreMemberToSquad({ parent, memberNpub: payload.requester_npub });
  }
  if (!opts.fanOut) return;
  const fanKey = `${announcementsGid.toLowerCase()}:${payload.requester_npub.toLowerCase()}`;
  const fanned = readFanout();
  if (fanned.has(fanKey)) return;
  try {
    await sendDmMessage(announcementsGid, formatSquadRejoinNeeded(payload), '', {
      virtualBucket: 'announcements',
    });
    fanned.add(fanKey);
    writeFanout(fanned);
  } catch (e) {
    console.warn('[squad-rejoin] fan-out failed', e);
  }
}

export function onMlsSquadRejoinNeeded(content: string, groupId: string): void {
  const parsed = parseSquadRejoinNeeded(content);
  if (!parsed) return;
  if (!sameMlsGroupId(parsed.parent_id, groupId)) return;
  void handleSquadRejoinRequest(parsed, { fanOut: false }).catch((e) =>
    console.warn('[squad-rejoin] needed failed', e),
  );
}

export function resetSquadRejoinState(): void {
  toastedParents.clear();
  acceptingParents.clear();
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}
