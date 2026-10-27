/**
 * After a storage wipe, ask an admitter to restore squads the user had joined, then
 * auto-accept only the welcomes that admitter sends. See docs/mls/INVITES_AND_MEMBERSHIP.md.
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
  type PendingMlsWelcome,
} from '../api/nostr';
import { finalizeSquadAfterAnnouncementsWelcome, acceptStagedChannelWelcome } from '../invites/accept-invite';
import { sameMlsGroupId } from '../invites/declined-welcomes';
import { recoverMissingSquadCatalog } from './squad-catalog-recover';
import { restoreMemberToSquad } from '../parent/restore-squad-access';
import { getAnnouncementsChannel } from '../parent-navbar';
import { persistenceKey } from '../../stores/persistence-context';
import { backendDmMessages } from '../../stores/dm';
import { currentUser } from '../../stores/auth-session';
import {
  acceptedSquadInviteIds,
  declinedSquadInviteIds,
  declinedWelcomeGroupIds,
} from '../../stores/invite-decisions';
import { squads, type Squad } from '../../stores/squads';
import { showToast } from '../../stores/toast';
import { dmError } from '../utils/dm-debug';

export const SQUAD_REJOIN_REQUEST_TYPE = 'squad_rejoin_request';
export const SQUAD_REJOIN_PENDING_PREFIX = 'pacto_squad_rejoin_pending';
export const SQUAD_REJOIN_HANDLED_PREFIX = 'pacto_squad_rejoin_handled';

const RETRY_BASE_MS = 45_000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;
/** Floor on timer waits so a burst of due rows cannot busy-loop the scan. */
const RETRY_MIN_WAKE_MS = 5_000;
const MAX_ATTEMPTS = 64;
const REQUEST_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CHANNEL_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Grace for the admin's per-channel `channel_in_squad` DMs before an empty channel row is dropped. */
const CHANNEL_IDLE_MS = 10 * 60 * 1000;
const HANDLED_WINDOW_MS = 10 * 60 * 1000;
/** Per-sender floor between inbound asks, so a stranger cannot drive repeated MLS member reads. */
const SENDER_THROTTLE_MS = 30_000;
const MAX_THROTTLE_ENTRIES = 200;
const MAX_ADMITTER_TARGETS = 3;
const MAX_PENDING_ROWS = 50;
const MAX_TOMBSTONE_ROWS = 50;
const MAX_HANDLED_ROWS = 100;

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
  /** Channel display names from `channel_in_squad` hints, keyed by channel group id. */
  channelNames: Record<string, string>;
}

/** `requesting`: asking admitters; `channels`: announcements joined, accepting restored channels; `abandoned`: tombstone. */
export type RejoinPhase = 'requesting' | 'channels' | 'abandoned';

interface PendingRejoin extends PlannedRejoin {
  requestId: string;
  phase: RejoinPhase;
  attempts: number;
  lastAttemptAt: number;
  createdAt: number;
  joinedAt: number;
  /** Welcomers who restored announcements; trusted for the squad's channel welcomes. */
  trustedWelcomers: string[];
}

interface RejoinThread {
  peerNpub: string;
  messages: Array<{ id?: string; mine?: boolean; content?: string }>;
}

const toastedParents = new Set<string>();
const acceptingParents = new Set<string>();
const lastRequestBySender = new Map<string, number>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function npubOk(value: string): boolean {
  return value.startsWith('npub1');
}

function listed(npubs: string[], npub: string): boolean {
  return npubs.some((n) => sameMlsGroupId(n, npub));
}

function parseRejoin(content: string | null | undefined): SquadRejoinPayload | null {
  if (!content?.trim().startsWith('{')) return null;
  try {
    const root = JSON.parse(content) as Record<string, unknown>;
    if (root.type !== SQUAD_REJOIN_REQUEST_TYPE) return null;
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
  return parseRejoin(content);
}

export function formatSquadRejoinRequest(payload: SquadRejoinPayload): string {
  return JSON.stringify({ type: SQUAD_REJOIN_REQUEST_TYPE, payload });
}

function addTarget(targets: Set<string>, npub: string, selfNpub: string): void {
  const n = npub.trim();
  if (!npubOk(n) || sameMlsGroupId(n, selfNpub)) return;
  if ([...targets].some((t) => sameMlsGroupId(t, n))) return;
  targets.add(n);
}

/**
 * Squads named by recovered invite DMs that this install has not joined.
 * Only received, undeclined invites qualify; `requireAccepted` also demands a recorded accept.
 */
export function planSquadRejoinRequests(opts: {
  threads: RejoinThread[];
  localGroupIds: Iterable<string>;
  selfNpub: string;
  requireAccepted: boolean;
  acceptedInviteMessageIds?: ReadonlySet<string>;
  declinedInviteMessageIds?: ReadonlySet<string>;
  declinedGroupIds?: Iterable<string>;
  onlyParentId?: string;
}): PlannedRejoin[] {
  const local = new Set(
    [...opts.localGroupIds].map((id) => id.trim().toLowerCase()).filter((id) => id.length > 0),
  );
  const declinedGroups = new Set(
    [...(opts.declinedGroupIds ?? [])].map((id) => id.trim().toLowerCase()),
  );
  const only = opts.onlyParentId?.trim().toLowerCase();
  const byParent = new Map<
    string,
    {
      parentId: string;
      squadName: string;
      admitters: Set<string>;
      peers: Set<string>;
      channels: Map<string, string>;
    }
  >();

  for (const thread of opts.threads) {
    for (const msg of thread.messages) {
      if (msg.mine) continue;
      const invite = parseSquadInviteMessage(msg.content ?? '');
      if (!invite?.groupId) continue;
      const parentId = invite.groupId.trim();
      const key = parentId.toLowerCase();
      if (only && key !== only) continue;
      if (declinedGroups.has(key)) continue;
      if (msg.id && opts.declinedInviteMessageIds?.has(msg.id)) continue;
      if (opts.requireAccepted && !(msg.id && opts.acceptedInviteMessageIds?.has(msg.id))) continue;
      let row = byParent.get(key);
      if (!row) {
        row = {
          parentId,
          squadName: invite.squadName?.trim() ?? '',
          admitters: new Set(),
          peers: new Set(),
          channels: new Map(),
        };
        byParent.set(key, row);
      } else if (!row.squadName && invite.squadName?.trim()) {
        row.squadName = invite.squadName.trim();
      }
      for (const npub of (invite.admitterNpubs ?? []).slice(0, MAX_ADMITTER_TARGETS * 2)) {
        addTarget(row.admitters, npub, opts.selfNpub);
      }
      addTarget(row.peers, thread.peerNpub, opts.selfNpub);
    }
  }

  for (const thread of opts.threads) {
    for (const msg of thread.messages) {
      if (msg.mine) continue;
      const channel = parseChannelInSquadMessage(msg.content ?? '');
      if (!channel?.announcementsGroupId) continue;
      const row = byParent.get(channel.announcementsGroupId.trim().toLowerCase());
      const channelId = channel.channelGroupId.trim();
      if (row && channelId) row.channels.set(channelId, channel.channelName);
    }
  }

  const planned: PlannedRejoin[] = [];
  for (const row of byParent.values()) {
    if (local.has(row.parentId.toLowerCase())) continue;
    const targets = new Set<string>();
    for (const npub of [...row.admitters].slice(0, MAX_ADMITTER_TARGETS)) targets.add(npub);
    for (const npub of row.peers) addTarget(targets, npub, opts.selfNpub);
    if (targets.size === 0) continue;
    planned.push({
      parentId: row.parentId,
      squadName: row.squadName || row.parentId,
      targets: [...targets],
      channelGroupIds: [...row.channels.keys()],
      channelNames: Object.fromEntries(row.channels),
    });
  }
  return planned;
}

function storageKey(prefix: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return persistenceKey(prefix) ?? null;
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function parsePendingRow(raw: unknown): PendingRejoin | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.parentId !== 'string' || !r.parentId.trim()) return null;
  if (typeof r.requestId !== 'string' || !r.requestId.trim()) return null;
  const phase: RejoinPhase =
    r.phase === 'channels' || r.phase === 'abandoned' ? r.phase : 'requesting';
  const targets = stringList(r.targets).filter(npubOk);
  if (targets.length === 0) return null;
  return {
    parentId: r.parentId.trim(),
    squadName: typeof r.squadName === 'string' ? r.squadName : r.parentId.trim(),
    targets,
    channelGroupIds: stringList(r.channelGroupIds),
    channelNames: stringRecord(r.channelNames),
    requestId: r.requestId.trim(),
    phase,
    attempts: finiteNumber(r.attempts),
    lastAttemptAt: finiteNumber(r.lastAttemptAt),
    createdAt: finiteNumber(r.createdAt) || Date.now(),
    joinedAt: finiteNumber(r.joinedAt),
    trustedWelcomers: stringList(r.trustedWelcomers).filter(npubOk),
  };
}

function readPending(): PendingRejoin[] {
  const key = storageKey(SQUAD_REJOIN_PENDING_PREFIX);
  if (!key) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parsePendingRow).filter((row): row is PendingRejoin => row !== null);
  } catch {
    return [];
  }
}

/** Trim live rows and tombstones against separate caps: evicting a tombstone resurrects its request. */
function trimPending(rows: PendingRejoin[]): PendingRejoin[] {
  const live = rows.filter(isActive).slice(-MAX_PENDING_ROWS);
  const tombstones = rows.filter((row) => !isActive(row)).slice(-MAX_TOMBSTONE_ROWS);
  return rows.filter((row) => live.includes(row) || tombstones.includes(row));
}

function writePending(rows: PendingRejoin[]): void {
  const key = storageKey(SQUAD_REJOIN_PENDING_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(trimPending(rows)));
  } catch {
    /* quota */
  }
}

function updateRow(parentId: string, fn: (row: PendingRejoin) => PendingRejoin | null): void {
  const rows = readPending();
  const i = rows.findIndex((r) => sameMlsGroupId(r.parentId, parentId));
  if (i < 0) return;
  const next = fn({ ...rows[i] });
  if (next) rows[i] = next;
  else rows.splice(i, 1);
  writePending(rows);
}

function handledKey(parentId: string, requesterNpub: string): string {
  return `${parentId.trim().toLowerCase()}:${requesterNpub.trim().toLowerCase()}`;
}

function readHandled(now: number): Record<string, number> {
  const key = storageKey(SQUAD_REJOIN_HANDLED_PREFIX);
  if (!key) return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && now - v < HANDLED_WINDOW_MS) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function markHandled(parentId: string, requesterNpub: string, now: number): void {
  const key = storageKey(SQUAD_REJOIN_HANDLED_PREFIX);
  if (!key) return;
  const next = readHandled(now);
  next[handledKey(parentId, requesterNpub)] = now;
  const kept = Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, MAX_HANDLED_ROWS);
  try {
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* quota */
  }
}

function newRequestId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `rejoin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isActive(row: PendingRejoin): boolean {
  return row.phase !== 'abandoned';
}

/** Earliest wall-clock time a row needs work: its next send, or the deadline that tombstones it. */
function nextWakeAt(rows: PendingRejoin[]): number | null {
  let soonest: number | null = null;
  for (const row of rows) {
    if (row.phase !== 'requesting' || row.attempts >= MAX_ATTEMPTS) continue;
    const at = Math.min(row.lastAttemptAt + retryWaitMs(row.attempts), row.createdAt + REQUEST_TTL_MS);
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest;
}

/** Wake only when a request is actually due; channel-phase rows wait on `mls_invite_received`. */
function syncRetryTimer(rows: PendingRejoin[]): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const at = nextWakeAt(rows);
  if (at === null) return;
  retryTimer = setTimeout(
    () => {
      retryTimer = null;
      void scanSquadRejoinAfterBackfill();
    },
    Math.max(at - Date.now(), RETRY_MIN_WAKE_MS),
  );
}

function toastRestoring(parentId: string): void {
  const key = parentId.toLowerCase();
  if (toastedParents.has(key)) return;
  toastedParents.add(key);
  showToast(get(t)('messaging.channel.mlsRejoinRestoring'));
}

function newRow(planned: PlannedRejoin, now: number): PendingRejoin {
  return {
    ...planned,
    requestId: newRequestId(),
    phase: 'requesting',
    attempts: 0,
    lastAttemptAt: 0,
    createdAt: now,
    joinedAt: 0,
    trustedWelcomers: [],
  };
}

/** Keep existing rows (including tombstones); add new squads; widen hints on live requests. */
function mergePending(planned: PlannedRejoin[], existing: PendingRejoin[], now: number): PendingRejoin[] {
  const out = [...existing];
  for (const row of planned) {
    const i = out.findIndex((p) => sameMlsGroupId(p.parentId, row.parentId));
    if (i < 0) {
      out.push(newRow(row, now));
      continue;
    }
    const prev = out[i];
    if (prev.phase !== 'requesting') continue;
    out[i] = {
      ...prev,
      channelGroupIds: [...new Set([...prev.channelGroupIds, ...row.channelGroupIds])],
      channelNames: { ...row.channelNames, ...prev.channelNames },
    };
  }
  return out;
}

/**
 * Move joined rows into the channel window, abandon stale requests, and drop channel rows
 * once their restored channels are in or the window closes.
 */
function advanceRows(rows: PendingRejoin[], localGroupIds: string[], now: number): PendingRejoin[] {
  const out: PendingRejoin[] = [];
  for (const row of rows) {
    let next = row;
    if (
      next.phase === 'requesting' &&
      localGroupIds.some((id) => sameMlsGroupId(id, next.parentId))
    ) {
      next = { ...next, phase: 'channels', joinedAt: now };
    }
    if (
      next.phase === 'requesting' &&
      (next.attempts >= MAX_ATTEMPTS || now - next.createdAt > REQUEST_TTL_MS)
    ) {
      next = { ...next, phase: 'abandoned' };
    }
    if (next.phase === 'channels') {
      const idle = next.channelGroupIds.length === 0 && now - next.joinedAt > CHANNEL_IDLE_MS;
      if (idle || now - next.joinedAt > CHANNEL_WINDOW_MS) continue;
    }
    out.push(next);
  }
  return out;
}

function retryWaitMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(attempts - 1, 0), RETRY_MAX_MS);
}

interface RejoinSendOutcome {
  rows: PendingRejoin[];
  /** Parent ids whose request DM left this device on this pass. */
  sentParentIds: string[];
}

/**
 * One target per attempt, rotating, so several admins do not restore the same member at once.
 * A send that throws re-arms the backoff but does not spend an attempt: an offline client
 * must not exhaust its budget against requests nobody received.
 */
async function sendDueRequests(rows: PendingRejoin[], now: number): Promise<RejoinSendOutcome> {
  const me = get(currentUser)?.npub?.trim() ?? '';
  const next: PendingRejoin[] = [];
  const sentParentIds: string[] = [];
  for (const row of rows) {
    const due = now - row.lastAttemptAt >= retryWaitMs(row.attempts);
    if (row.phase !== 'requesting' || !due || row.attempts >= MAX_ATTEMPTS) {
      next.push(row);
      continue;
    }
    const target = row.targets[row.attempts % row.targets.length];
    let sent = false;
    try {
      await sendDmMessage(
        target,
        formatSquadRejoinRequest({
          parent_id: row.parentId,
          requester_npub: me,
          request_id: row.requestId,
        }),
      );
      sent = true;
    } catch (e) {
      console.warn('[squad-rejoin] request DM failed', target.slice(0, 16), e);
    }
    if (sent) {
      toastRestoring(row.parentId);
      sentParentIds.push(row.parentId);
    }
    next.push({ ...row, attempts: sent ? row.attempts + 1 : row.attempts, lastAttemptAt: now });
  }
  return { rows: next, sentParentIds };
}

function trustedWelcome(row: PendingRejoin, welcome: PendingMlsWelcome): boolean {
  const welcomer = welcome.welcomer?.trim() ?? '';
  if (!welcomer || !welcome.id) return false;
  return listed([...row.targets, ...row.trustedWelcomers], welcomer);
}

function trustedSender(row: PendingRejoin, senderNpub: string): boolean {
  return listed([...row.targets, ...row.trustedWelcomers], senderNpub);
}

function welcomesFor(
  welcomes: PendingMlsWelcome[],
  row: PendingRejoin,
  groupId: string,
): PendingMlsWelcome[] {
  return welcomes.filter((w) => sameMlsGroupId(w.nostr_group_id, groupId) && trustedWelcome(row, w));
}

/** Accept restored welcomes (announcements, then channels) from welcomers this install asked. */
export async function tryAcceptRememberedRejoinWelcomes(groupId?: string | null): Promise<void> {
  const focus = groupId?.trim() ?? '';
  let rows = readPending().filter(isActive);
  if (focus) {
    rows = rows.filter(
      (row) =>
        sameMlsGroupId(row.parentId, focus) ||
        row.channelGroupIds.some((id) => sameMlsGroupId(id, focus)),
    );
  }
  if (rows.length === 0) return;

  let welcomes: PendingMlsWelcome[];
  try {
    welcomes = await listPendingMlsWelcomes();
  } catch (e) {
    dmError('list welcomes for squad rejoin', e);
    return;
  }

  for (const original of rows) {
    const lock = original.parentId.toLowerCase();
    if (acceptingParents.has(lock)) continue;
    acceptingParents.add(lock);
    try {
      await acceptForRow(original, welcomes);
    } catch (e) {
      dmError('accept squad rejoin welcome', e);
    } finally {
      acceptingParents.delete(lock);
    }
  }
}

async function acceptForRow(original: PendingRejoin, welcomes: PendingMlsWelcome[]): Promise<void> {
  let row = original;
  if (row.phase === 'requesting') {
    for (const ann of welcomesFor(welcomes, row, row.parentId)) {
      try {
        await acceptMlsWelcome(ann.id);
      } catch (e) {
        dmError('accept squad rejoin announcements welcome', e);
        continue;
      }
      const trusted = [...new Set([...row.trustedWelcomers, ann.welcomer])];
      updateRow(row.parentId, (r) => ({
        ...r,
        phase: 'channels',
        joinedAt: Date.now(),
        trustedWelcomers: trusted,
      }));
      row = { ...row, phase: 'channels', trustedWelcomers: trusted };
      try {
        await finalizeSquadAfterAnnouncementsWelcome(
          { groupId: row.parentId, name: row.squadName || row.parentId },
          null,
        );
        await recoverMissingSquadCatalog();
      } catch (e) {
        dmError('finalize squad after rejoin welcome', e);
      }
      break;
    }
    if (row.phase === 'requesting') return;
  }

  for (const channelId of row.channelGroupIds) {
    for (const welcome of welcomesFor(welcomes, row, channelId)) {
      try {
        await acceptStagedChannelWelcome({
          welcomeId: welcome.id,
          channelGroupId: welcome.nostr_group_id,
          parentId: row.parentId,
          channelName: parseChannelName(row, channelId),
        });
      } catch (e) {
        dmError('accept squad rejoin channel welcome', e);
        continue;
      }
      updateRow(row.parentId, (r) => ({
        ...r,
        channelGroupIds: r.channelGroupIds.filter((id) => !sameMlsGroupId(id, channelId)),
      }));
      break;
    }
  }
}

function parseChannelName(row: PendingRejoin, channelId: string): string {
  const hit = Object.entries(row.channelNames).find(([id]) => sameMlsGroupId(id, channelId));
  return hit?.[1] || channelId;
}

async function localGroupIds(): Promise<string[] | null> {
  try {
    return (await getMlsGroupMetadata()).map((g) => g.group_id);
  } catch (e) {
    dmError('mls metadata for squad rejoin', e);
    return null;
  }
}

function dmThreads(): RejoinThread[] {
  return Object.entries(get(backendDmMessages)).map(([peerNpub, messages]) => ({
    peerNpub,
    messages,
  }));
}

/** Ask admitters to restore squads the user had accepted but that are missing locally. */
export async function scanSquadRejoinAfterBackfill(): Promise<void> {
  const me = get(currentUser)?.npub?.trim();
  if (!me) return;
  const localIds = await localGroupIds();
  if (!localIds) return;
  const now = Date.now();
  const planned = planSquadRejoinRequests({
    threads: dmThreads(),
    localGroupIds: localIds,
    selfNpub: me,
    requireAccepted: true,
    acceptedInviteMessageIds: new Set(get(acceptedSquadInviteIds)),
    declinedInviteMessageIds: new Set(get(declinedSquadInviteIds)),
    declinedGroupIds: get(declinedWelcomeGroupIds),
  });
  const planRows = advanceRows(mergePending(planned, readPending(), now), localIds, now);
  const { rows } = await sendDueRequests(planRows, now);
  writePending(rows);
  await tryAcceptRememberedRejoinWelcomes();

  const after = await localGroupIds();
  const settled = advanceRows(readPending(), after ?? localIds, Date.now());
  writePending(settled);
  syncRetryTimer(settled);
}

/** User-initiated restore for an invite card that has no recorded accept (full local wipe). */
export async function requestSquadRejoinForInvite(parentId: string): Promise<boolean> {
  const me = get(currentUser)?.npub?.trim();
  if (!me) return false;
  const localIds = await localGroupIds();
  if (!localIds) return false;
  const planned = planSquadRejoinRequests({
    threads: dmThreads(),
    localGroupIds: localIds,
    selfNpub: me,
    requireAccepted: false,
    declinedInviteMessageIds: new Set(get(declinedSquadInviteIds)),
    declinedGroupIds: get(declinedWelcomeGroupIds),
    onlyParentId: parentId,
  })[0];
  if (!planned) return false;
  const now = Date.now();
  const rows = readPending().filter((r) => !sameMlsGroupId(r.parentId, planned.parentId));
  rows.push(newRow(planned, now));
  toastedParents.delete(planned.parentId.toLowerCase());
  const outcome = await sendDueRequests(rows, now);
  writePending(outcome.rows);
  syncRetryTimer(outcome.rows);
  return outcome.sentParentIds.some((id) => sameMlsGroupId(id, planned.parentId));
}

/** Record a live channel-in-squad DM from a trusted welcomer for a rejoin in progress. */
export function noteRejoinChannelDm(content: string, senderNpub: string): void {
  const channel = parseChannelInSquadMessage(content);
  if (!channel?.announcementsGroupId || !channel.channelGroupId) return;
  const row = readPending().find(
    (r) => isActive(r) && sameMlsGroupId(r.parentId, channel.announcementsGroupId),
  );
  if (!row || !trustedSender(row, senderNpub)) return;
  if (!row.channelGroupIds.some((id) => sameMlsGroupId(id, channel.channelGroupId))) {
    updateRow(row.parentId, (r) => ({
      ...r,
      channelGroupIds: [...r.channelGroupIds, channel.channelGroupId],
      channelNames: { ...r.channelNames, [channel.channelGroupId]: channel.channelName },
    }));
  }
  void tryAcceptRememberedRejoinWelcomes(channel.channelGroupId);
}

/**
 * A sender whose last ask was rejected waits before we spend another MLS member read on them.
 * Accepted asks never throttle: the handled window governs those.
 */
function throttleSender(senderNpub: string, now: number): void {
  lastRequestBySender.set(senderNpub.trim().toLowerCase(), now);
  if (lastRequestBySender.size <= MAX_THROTTLE_ENTRIES) return;
  for (const [sender, at] of lastRequestBySender) {
    if (now - at >= SENDER_THROTTLE_MS) lastRequestBySender.delete(sender);
  }
}

function findSquad(parentId: string): Squad | undefined {
  return get(squads).find(
    (s) =>
      sameMlsGroupId(s.id, parentId) ||
      sameMlsGroupId(getAnnouncementsChannel(s).groupId, parentId),
  );
}

/**
 * A rejoin ask arrived by DM. Only an MLS admin acts, and only when the DM sender is the
 * requester; a requester with no leaf is ignored, so a kick is not undone.
 */
export async function handleSquadRejoinRequest(
  payload: SquadRejoinPayload,
  senderNpub: string,
): Promise<void> {
  const me = get(currentUser)?.npub?.trim();
  if (!me || sameMlsGroupId(payload.requester_npub, me)) return;
  if (!sameMlsGroupId(payload.requester_npub, senderNpub)) return;
  const parent = findSquad(payload.parent_id);
  if (!parent) return;
  const announcementsGid = getAnnouncementsChannel(parent).groupId?.trim();
  if (!announcementsGid) return;
  if (handledKey(announcementsGid, payload.requester_npub) in readHandled(Date.now())) return;
  const askedAt = lastRequestBySender.get(senderNpub.trim().toLowerCase());
  const sinceAsk = askedAt === undefined ? Number.POSITIVE_INFINITY : Date.now() - askedAt;
  if (sinceAsk >= 0 && sinceAsk < SENDER_THROTTLE_MS) return;

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
  if (!listed(members, payload.requester_npub) || !listed(admins, me)) {
    throttleSender(senderNpub, Date.now());
    return;
  }

  const result = await restoreMemberToSquad({ parent, memberNpub: payload.requester_npub });
  if (result.ok) markHandled(announcementsGid, payload.requester_npub, Date.now());
  else console.warn('[squad-rejoin] restore failed', result.error);
}

export function resetSquadRejoinState(): void {
  toastedParents.clear();
  acceptingParents.clear();
  lastRequestBySender.clear();
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}
