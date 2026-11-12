/**
 * One history sequence per group after a welcome is marked.
 * Wire rules: docs/mls/CHANNEL_HISTORY_BACKFILL.md.
 */

import { get, writable } from 'svelte/store';
import {
  exportChannelHistory,
  importChannelHistory,
  listImportedHistoryIds,
  sendHistoryGiftWrap,
} from '../api/history-backfill';
import { getMlsGroupMembers, sendDmMessage } from '../api/nostr';
import {
  buildHistoryChunks,
  parseHistoryChunk,
  type HistoryBucket,
  type HistoryRequest,
  type HistoryUnavailable,
} from '../messaging/history-backfill';
import { currentUser } from '../../stores/auth-session';
import { dmError } from '../utils/dm-debug';
import {
  HISTORY_ATTEMPT_LIMIT,
  HISTORY_ATTEMPT_TIMEOUT_MS,
  clearHistoryBackfillSession,
  designatedCandidates,
  designatedForAttempt,
  giftMatchesAttempt,
  historyBackfillRequest,
  historyRequestForSelf,
  claimHistoryServeSlot,
  isHistoryBackfillFinished,
  isStaleHistoryRequest,
  markHistoryBackfillFinished,
  noteHistoryBackfillRunning,
  noteHistoryBackfillStopped,
  randomHistoryRequestId,
} from './channel-history-backfill';

export const importedHistoryIdsByGroup = writable<Record<string, string[]>>({});

const servedRequestIds = new Set<string>();

type AttemptResolve = (outcome: 'chunk' | 'unavailable' | 'timeout') => void;

type LiveAttempt = {
  groupId: string;
  bucket: HistoryBucket;
  requestId: string;
  designatedNpub: string;
  gotChunk: boolean;
  seenIndexes: Set<number>;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: AttemptResolve | null;
};

const liveByGroup = new Map<string, LiveAttempt>();

function wireGroupId(groupId: string): string {
  return groupId.trim().toLowerCase();
}

export function rememberImportedHistoryIds(groupId: string, ids: string[]): void {
  const id = wireGroupId(groupId);
  if (!id || ids.length === 0) return;
  importedHistoryIdsByGroup.update((map) => {
    const next = new Set(map[id] ?? []);
    for (const messageId of ids) {
      if (messageId) next.add(messageId);
    }
    return { ...map, [id]: [...next] };
  });
}

export async function refreshImportedHistoryIds(groupId: string): Promise<void> {
  const id = wireGroupId(groupId);
  if (!id) return;
  try {
    rememberImportedHistoryIds(id, await listImportedHistoryIds(id));
  } catch (err) {
    dmError('list_imported_history_ids', err);
  }
}

export function clearChannelHistorySession(): void {
  for (const live of liveByGroup.values()) {
    if (live.timer) clearTimeout(live.timer);
  }
  liveByGroup.clear();
  servedRequestIds.clear();
  clearHistoryBackfillSession();
  importedHistoryIdsByGroup.set({});
}

function selfNpub(): string {
  return get(currentUser)?.npub?.trim() ?? '';
}

function finishLive(groupId: string): void {
  const live = liveByGroup.get(groupId);
  if (!live) return;
  if (live.timer) clearTimeout(live.timer);
  live.timer = null;
  live.resolve = null;
  liveByGroup.delete(groupId);
}

async function postHistoryRequest(groupId: string, request: HistoryRequest): Promise<boolean> {
  try {
    return await sendDmMessage(groupId, JSON.stringify(request), '', {
      virtualBucket: request.bucket === 'announcements' ? 'announcements' : undefined,
    });
  } catch (err) {
    dmError('history_request', err);
    return false;
  }
}

function waitForAttempt(live: LiveAttempt): Promise<'chunk' | 'unavailable' | 'timeout'> {
  return new Promise((resolve) => {
    live.resolve = resolve;
    live.timer = setTimeout(() => {
      if (!live.resolve) return;
      live.resolve = null;
      if (live.timer) clearTimeout(live.timer);
      live.timer = null;
      resolve('timeout');
    }, HISTORY_ATTEMPT_TIMEOUT_MS);
  });
}

function settle(live: LiveAttempt, outcome: 'chunk' | 'unavailable'): void {
  if (!live.resolve) return;
  const resolve = live.resolve;
  live.resolve = null;
  if (live.timer) clearTimeout(live.timer);
  live.timer = null;
  resolve(outcome);
}

async function loadMembers(groupId: string): Promise<string[] | null> {
  try {
    return (await getMlsGroupMembers(groupId)).members ?? [];
  } catch (err) {
    dmError('history roster', err);
    return null;
  }
}

async function runSequence(groupId: string, bucket: HistoryBucket): Promise<void> {
  const id = wireGroupId(groupId);
  let members = await loadMembers(groupId);
  if (!members || members.length === 0) {
    const retryMs = import.meta.env.VITEST ? 0 : 1000;
    await new Promise((resolve) => setTimeout(resolve, retryMs));
    members = await loadMembers(groupId);
  }
  const self = selfNpub();
  if (!members || !self) return;
  const candidates = designatedCandidates(members, self);
  if (candidates.length === 0) {
    markHistoryBackfillFinished(id);
    return;
  }
  try {
    const existing = await listImportedHistoryIds(id);
    if (existing.length > 0) {
      rememberImportedHistoryIds(id, existing);
      markHistoryBackfillFinished(id);
      return;
    }
  } catch (err) {
    dmError('history import probe', err);
  }

  for (let attempt = 1; attempt <= HISTORY_ATTEMPT_LIMIT; attempt += 1) {
    const designatedNpub = designatedForAttempt(candidates, attempt);
    if (!designatedNpub) break;
    const request: HistoryRequest = {
      type: 'history_request',
      version: 1,
      requestId: randomHistoryRequestId(),
      groupId: id,
      bucket,
      attempt: attempt as 1 | 2 | 3,
      designatedNpub,
    };
    const posted = await postHistoryRequest(groupId, request);
    if (!posted) return;
    const live: LiveAttempt = {
      groupId: id,
      bucket,
      requestId: request.requestId,
      designatedNpub,
      gotChunk: false,
      seenIndexes: new Set(),
      timer: null,
      resolve: null,
    };
    liveByGroup.set(id, live);
    const outcome = await waitForAttempt(live);
    if (outcome === 'chunk' || live.gotChunk) {
      markHistoryBackfillFinished(id);
      return;
    }
    finishLive(id);
  }
  markHistoryBackfillFinished(id);
}

/** Start after the welcome is marked. Hub shelves that are not chat return without a request. */
export function beginChannelHistoryBackfill(channelName: string, groupId: string): void {
  const scope = historyBackfillRequest(channelName);
  const id = wireGroupId(groupId);
  if (!scope || !id || isHistoryBackfillFinished(id)) return;
  if (!noteHistoryBackfillRunning(id)) return;
  void runSequence(groupId, scope.bucket).finally(() => noteHistoryBackfillStopped(id));
}

/** Answer only a fresh request that arrived in the group it names, from a member of that group. */
export async function handleIncomingHistoryRequest(
  content: string,
  senderNpub: string,
  arrivalGroupId: string,
  sentAtMs: number | undefined
): Promise<void> {
  const request = historyRequestForSelf(content, selfNpub());
  const requester = senderNpub.trim();
  const groupId = wireGroupId(arrivalGroupId);
  if (!request || !requester || !groupId || request.groupId !== groupId) return;
  if (isStaleHistoryRequest(sentAtMs, Date.now()) || servedRequestIds.has(request.requestId)) return;
  servedRequestIds.add(request.requestId);
  const members = await loadMembers(groupId);
  if (!members?.some((member) => member.trim() === requester)) return;
  if (!claimHistoryServeSlot(requester, groupId, Date.now())) return;
  try {
    const messages = await exportChannelHistory(groupId, request.bucket);
    const built = buildHistoryChunks(
      { requestId: request.requestId, groupId, bucket: request.bucket },
      messages
    );
    if (!built.ok) {
      const unavailable: HistoryUnavailable = {
        type: 'history_unavailable',
        version: 1,
        requestId: request.requestId,
        groupId,
        reason: built.reason === 'over_cap' ? 'over_cap' : 'empty',
      };
      await sendHistoryGiftWrap(requester, JSON.stringify(unavailable));
      return;
    }
    for (const chunk of built.chunks) {
      await sendHistoryGiftWrap(requester, JSON.stringify(chunk));
    }
  } catch (err) {
    dmError('history serve', err);
  }
}

export async function handleHistoryGift(senderNpub: string, content: string): Promise<void> {
  const sender = senderNpub.trim();
  if (!sender) return;
  for (const live of liveByGroup.values()) {
    const kind = giftMatchesAttempt(
      content,
      {
        requestId: live.requestId,
        groupId: live.groupId,
        bucket: live.bucket,
        designatedNpub: live.designatedNpub,
      },
      sender
    );
    if (!kind) continue;
    if (kind === 'unavailable') {
      if (!live.gotChunk) settle(live, 'unavailable');
      return;
    }
    const parsed = parseHistoryChunk(content, {
      requestId: live.requestId,
      groupId: live.groupId,
      bucket: live.bucket,
    });
    if (!parsed.ok || live.seenIndexes.has(parsed.chunk.index)) return;
    try {
      const inserted = await importChannelHistory(live.groupId, live.bucket, parsed.chunk.messages);
      rememberImportedHistoryIds(live.groupId, inserted);
    } catch (err) {
      dmError('history import', err);
      return;
    }
    live.seenIndexes.add(parsed.chunk.index);
    live.gotChunk = true;
    settle(live, 'chunk');
    if (live.seenIndexes.size >= parsed.chunk.total) finishLive(live.groupId);
    return;
  }
}
