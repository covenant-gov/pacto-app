/**
 * History chunk codec. Wire rules: docs/mls/CHANNEL_HISTORY_BACKFILL.md.
 */

import { isStructuredProductContent } from './structured-content-notice';

export const HISTORY_WIRE_VERSION = 1;
export const HISTORY_RUMOR_JSON_MAX_BYTES = 12_288;
export const HISTORY_CHUNK_MAX_COUNT = 32;

const REQUEST_ID_RE = /^[0-9a-f]{32}$/;
const HUMAN_KINDS = new Set([14, 15, 16, 7]);

export type HistoryBucket = 'announcements' | null;

export interface HistoryMessage {
  id: string;
  kind: 14 | 15 | 16 | 7;
  createdAt: number;
  authorNpub: string;
  content: string;
  tags: string[][];
  referenceId: string | null;
}

export interface HistoryChunk {
  type: 'history_chunk';
  version: 1;
  requestId: string;
  groupId: string;
  bucket: HistoryBucket;
  index: number;
  total: number;
  messages: HistoryMessage[];
}

export interface HistoryRequest {
  type: 'history_request';
  version: 1;
  requestId: string;
  groupId: string;
  bucket: HistoryBucket;
  attempt: 1 | 2 | 3;
  designatedNpub: string;
}

export interface HistoryUnavailable {
  type: 'history_unavailable';
  version: 1;
  requestId: string;
  groupId: string;
  reason: 'empty' | 'over_cap';
}

export interface HistoryRequestContext {
  requestId: string;
  groupId: string;
  bucket: HistoryBucket;
}

export type HistoryChunkFailure =
  | 'oversized'
  | 'malformed'
  | 'version'
  | 'group'
  | 'request'
  | 'bucket'
  | 'range'
  | 'message';

export type HistoryBuildResult =
  | { ok: true; chunks: HistoryChunk[] }
  | { ok: false; reason: 'empty' | 'over_cap' | 'malformed' };

export function buildHistoryChunks(
  header: HistoryRequestContext,
  messages: HistoryMessage[]
): HistoryBuildResult {
  const requestId = header.requestId.trim().toLowerCase();
  const groupId = header.groupId.trim().toLowerCase();
  if (!REQUEST_ID_RE.test(requestId) || !groupId) {
    return { ok: false, reason: 'malformed' };
  }
  const canonical: HistoryRequestContext = {
    requestId,
    groupId,
    bucket: header.bucket,
  };
  const sorted = [...messages].sort(compareMessages);
  const fitting = sorted.filter(
    (message) => rumorBytes(chunkOf(canonical, [message], 31, HISTORY_CHUNK_MAX_COUNT)) <= HISTORY_RUMOR_JSON_MAX_BYTES
  );
  if (fitting.length === 0) return { ok: false, reason: 'empty' };

  const groups: HistoryMessage[][] = [];
  let current: HistoryMessage[] = [];
  for (const message of fitting) {
    const trial = current.concat([message]);
    const tooBig =
      current.length > 0 &&
      rumorBytes(chunkOf(canonical, trial, 31, HISTORY_CHUNK_MAX_COUNT)) > HISTORY_RUMOR_JSON_MAX_BYTES;
    if (tooBig) {
      groups.push(current);
      current = [message];
    } else {
      current = trial;
    }
  }
  if (current.length > 0) groups.push(current);
  if (groups.length > HISTORY_CHUNK_MAX_COUNT) return { ok: false, reason: 'over_cap' };

  const total = groups.length;
  return {
    ok: true,
    chunks: groups.map((group, index) => chunkOf(canonical, group, index, total)),
  };
}

export function parseHistoryChunk(
  raw: string,
  expected: HistoryRequestContext
): { ok: true; chunk: HistoryChunk } | { ok: false; reason: HistoryChunkFailure } {
  if (rumorBytes(raw) > HISTORY_RUMOR_JSON_MAX_BYTES) return { ok: false, reason: 'oversized' };
  const obj = parseObject(raw);
  if (!obj || obj.type !== 'history_chunk') return { ok: false, reason: 'malformed' };
  if (obj.version !== HISTORY_WIRE_VERSION) return { ok: false, reason: 'version' };

  const requestId = readHexId(obj.requestId);
  const groupId = readGroupId(obj.groupId);
  const bucket = readBucket(obj);
  if (!requestId || !groupId || bucket === undefined) return { ok: false, reason: 'malformed' };
  if (requestId !== expected.requestId.trim().toLowerCase()) return { ok: false, reason: 'request' };
  if (groupId !== expected.groupId.trim().toLowerCase()) return { ok: false, reason: 'group' };
  if (bucket !== expected.bucket) return { ok: false, reason: 'bucket' };

  const index = readUint(obj.index);
  const total = readUint(obj.total);
  if (index === null || total === null || total < 1 || index >= total) {
    return { ok: false, reason: 'range' };
  }
  if (!Array.isArray(obj.messages) || obj.messages.length === 0) {
    return { ok: false, reason: 'message' };
  }
  const messages: HistoryMessage[] = [];
  for (const entry of obj.messages) {
    const message = readMessage(entry);
    if (!message) return { ok: false, reason: 'message' };
    messages.push(message);
  }
  return {
    ok: true,
    chunk: {
      type: 'history_chunk',
      version: 1,
      requestId,
      groupId,
      bucket,
      index,
      total,
      messages,
    },
  };
}

export function parseHistoryRequest(
  raw: string
): { ok: true; request: HistoryRequest } | { ok: false; reason: 'malformed' | 'version' } {
  const obj = parseObject(raw);
  if (!obj || obj.type !== 'history_request') return { ok: false, reason: 'malformed' };
  if (obj.version !== HISTORY_WIRE_VERSION) return { ok: false, reason: 'version' };
  const requestId = readHexId(obj.requestId);
  const groupId = readGroupId(obj.groupId);
  const bucket = readBucket(obj);
  const attempt = obj.attempt;
  const designatedNpub = typeof obj.designatedNpub === 'string' ? obj.designatedNpub.trim() : '';
  if (
    !requestId ||
    !groupId ||
    bucket === undefined ||
    (attempt !== 1 && attempt !== 2 && attempt !== 3) ||
    !designatedNpub
  ) {
    return { ok: false, reason: 'malformed' };
  }
  return {
    ok: true,
    request: {
      type: 'history_request',
      version: 1,
      requestId,
      groupId,
      bucket,
      attempt,
      designatedNpub,
    },
  };
}

export function parseHistoryUnavailable(
  raw: string,
  expected: Pick<HistoryRequestContext, 'requestId' | 'groupId'>
): { ok: true; unavailable: HistoryUnavailable } | { ok: false; reason: HistoryChunkFailure } {
  const obj = parseObject(raw);
  if (!obj || obj.type !== 'history_unavailable') return { ok: false, reason: 'malformed' };
  if (obj.version !== HISTORY_WIRE_VERSION) return { ok: false, reason: 'version' };
  const requestId = readHexId(obj.requestId);
  const groupId = readGroupId(obj.groupId);
  if (!requestId || !groupId) return { ok: false, reason: 'malformed' };
  if (requestId !== expected.requestId.trim().toLowerCase()) return { ok: false, reason: 'request' };
  if (groupId !== expected.groupId.trim().toLowerCase()) return { ok: false, reason: 'group' };
  if (obj.reason !== 'empty' && obj.reason !== 'over_cap') return { ok: false, reason: 'malformed' };
  return {
    ok: true,
    unavailable: {
      type: 'history_unavailable',
      version: 1,
      requestId,
      groupId,
      reason: obj.reason,
    },
  };
}

function chunkOf(
  header: HistoryRequestContext,
  messages: HistoryMessage[],
  index: number,
  total: number
): HistoryChunk {
  return {
    type: 'history_chunk',
    version: 1,
    requestId: header.requestId,
    groupId: header.groupId,
    bucket: header.bucket,
    index,
    total,
    messages,
  };
}

function compareMessages(a: HistoryMessage, b: HistoryMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function rumorBytes(value: string | HistoryChunk): number {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return new TextEncoder().encode(raw).length;
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readHexId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return REQUEST_ID_RE.test(id) ? id : null;
}

function readGroupId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return id ? id : null;
}

/** `undefined` means the field is missing or not a legal bucket. */
function readBucket(obj: Record<string, unknown>): HistoryBucket | undefined {
  if (!Object.prototype.hasOwnProperty.call(obj, 'bucket')) return undefined;
  if (obj.bucket === null) return null;
  if (obj.bucket === 'announcements') return 'announcements';
  return undefined;
}

function readUint(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function readMessage(value: unknown): HistoryMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id.trim()) return null;
  if (typeof row.kind !== 'number' || !HUMAN_KINDS.has(row.kind)) return null;
  const createdAt = readUint(row.createdAt);
  if (createdAt === null) return null;
  if (typeof row.authorNpub !== 'string' || !row.authorNpub.trim()) return null;
  if (typeof row.content !== 'string') return null;
  if (isStructuredProductContent(row.content)) return null;
  if (!Array.isArray(row.tags) || !row.tags.every(isStringArray)) return null;
  if (row.referenceId !== null && typeof row.referenceId !== 'string') return null;
  return {
    id: row.id,
    kind: row.kind as HistoryMessage['kind'],
    createdAt,
    authorNpub: row.authorNpub,
    content: row.content,
    tags: row.tags as string[][],
    referenceId: row.referenceId,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
