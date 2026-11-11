/**
 * Who to ask, when to stop, and which channel names get a history copy.
 * Wire shapes: docs/mls/CHANNEL_HISTORY_BACKFILL.md.
 */

import { parseHistoryChunk, parseHistoryRequest, parseHistoryUnavailable, type HistoryBucket, type HistoryRequest } from '../messaging/history-backfill';
import { persistenceKey } from '../../stores/persistence-context';

export const HISTORY_ATTEMPT_TIMEOUT_MS = 20_000;
export const HISTORY_ATTEMPT_LIMIT = 3;
export const HISTORY_BACKFILL_DONE_PREFIX = 'mls_history_backfill_done_v1';

const SKIP_CHANNEL_NAMES = new Set([
  'polls',
  'join-requests',
  'personal-alerts',
  'tools',
  'events',
  'docs',
  'board',
  'governance',
  'settings',
  'gov-practice',
]);

export type HistoryBackfillScope = {
  bucket: HistoryBucket;
};

/** Announcements asks for that bucket. Other hub shelves are not chat. Custom channels ask the whole group. */
export function historyBackfillRequest(channelName: string): HistoryBackfillScope | null {
  const name = channelName.trim().toLowerCase();
  if (name === 'announcements') return { bucket: 'announcements' };
  if (!name || SKIP_CHANNEL_NAMES.has(name)) return null;
  return { bucket: null };
}

/** Roster npubs except this device, sorted so every member picks the same order. */
export function designatedCandidates(members: string[], selfNpub: string): string[] {
  const self = selfNpub.trim();
  const unique = new Set(members.map((member) => member.trim()).filter((member) => member && member !== self));
  return [...unique].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function designatedForAttempt(candidates: string[], attempt: number): string | null {
  if (attempt < 1 || attempt > HISTORY_ATTEMPT_LIMIT) return null;
  return candidates[attempt - 1] ?? null;
}

export function shouldServeHistoryRequest(request: HistoryRequest, selfNpub: string): boolean {
  return request.designatedNpub === selfNpub.trim();
}

function readJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Hide these in the channel and in DMs even when the payload is otherwise invalid. */
export function isHistoryRequestContent(content: string): boolean {
  return readJsonObject(content)?.type === 'history_request';
}

export function isHistoryGiftWrapContent(content: string): boolean {
  const type = readJsonObject(content)?.type;
  return type === 'history_chunk' || type === 'history_unavailable';
}

export function loadFinishedHistoryGroups(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  const key = persistenceKey(HISTORY_BACKFILL_DONE_PREFIX);
  if (!key) return new Set();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string').map((id) => id.trim().toLowerCase()));
  } catch {
    return new Set();
  }
}

export function markHistoryBackfillFinished(groupId: string): void {
  const id = groupId.trim().toLowerCase();
  if (!id || typeof localStorage === 'undefined') return;
  const key = persistenceKey(HISTORY_BACKFILL_DONE_PREFIX);
  if (!key) return;
  const done = loadFinishedHistoryGroups();
  done.add(id);
  try {
    localStorage.setItem(key, JSON.stringify([...done]));
  } catch {
    /* ignore quota */
  }
}

export function isHistoryBackfillFinished(groupId: string): boolean {
  return loadFinishedHistoryGroups().has(groupId.trim().toLowerCase());
}

/** True when this gift belongs to the attempt that is still open. */
export function giftMatchesAttempt(
  content: string,
  expected: { requestId: string; groupId: string; bucket: HistoryBucket; designatedNpub: string },
  senderNpub: string
): 'chunk' | 'unavailable' | null {
  if (senderNpub.trim() !== expected.designatedNpub) return null;
  const unavailable = parseHistoryUnavailable(content, {
    requestId: expected.requestId,
    groupId: expected.groupId,
  });
  if (unavailable.ok) return 'unavailable';
  const chunk = parseHistoryChunk(content, expected);
  if (chunk.ok) return 'chunk';
  return null;
}

/** Read a request only when this device is the one named. */
export function historyRequestForSelf(content: string, selfNpub: string): HistoryRequest | null {
  const parsed = parseHistoryRequest(content);
  if (!parsed.ok) return null;
  if (!shouldServeHistoryRequest(parsed.request, selfNpub)) return null;
  return parsed.request;
}

export function randomHistoryRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** In-memory sequence, so a second welcome for the same group does not post again. */
const runningGroups = new Set<string>();

export function isHistoryBackfillRunning(groupId: string): boolean {
  return runningGroups.has(groupId.trim().toLowerCase());
}

export function noteHistoryBackfillRunning(groupId: string): boolean {
  const id = groupId.trim().toLowerCase();
  if (!id || runningGroups.has(id)) return false;
  runningGroups.add(id);
  return true;
}

export function noteHistoryBackfillStopped(groupId: string): void {
  runningGroups.delete(groupId.trim().toLowerCase());
}

export function clearHistoryBackfillSession(): void {
  runningGroups.clear();
}
