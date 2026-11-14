import { describe, expect, it } from 'vitest';
import {
  HISTORY_CHUNK_MAX_COUNT,
  HISTORY_RUMOR_JSON_MAX_BYTES,
  buildHistoryChunks,
  parseHistoryChunk,
  parseHistoryRequest,
  parseHistoryUnavailable,
  type HistoryMessage,
  type HistoryRequestContext,
} from './history-backfill';

const REQUEST = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const GROUP = 'abc123';

const EXPECTED: HistoryRequestContext = {
  requestId: REQUEST,
  groupId: GROUP,
  bucket: 'announcements',
};

const GOLDEN = JSON.stringify({
  type: 'history_chunk',
  version: 1,
  requestId: REQUEST,
  groupId: GROUP,
  bucket: 'announcements',
  index: 0,
  total: 1,
  messages: [
    {
      id: 'm1',
      kind: 14,
      createdAt: 1_700_000_000,
      authorNpub: 'npub1alice',
      content: 'hello',
      tags: [],
      referenceId: null,
    },
  ],
});

function message(overrides: Partial<HistoryMessage> = {}): HistoryMessage {
  return {
    id: 'm1',
    kind: 14,
    createdAt: 1_700_000_000,
    authorNpub: 'npub1alice',
    content: 'hello',
    tags: [],
    referenceId: null,
    ...overrides,
  };
}

describe('buildHistoryChunks', () => {
  it('matches the golden chunk', () => {
    const built = buildHistoryChunks(EXPECTED, [message()]);
    expect(built).toEqual({ ok: true, chunks: [JSON.parse(GOLDEN)] });
    expect(JSON.stringify(built.ok && built.chunks[0])).toBe(GOLDEN);
  });

  it('sorts by time then id and keeps human-chat shapes', () => {
    const built = buildHistoryChunks(EXPECTED, [
      message({ id: 'b', createdAt: 20, content: 'second' }),
      message({
        id: 'mention',
        createdAt: 10,
        content: JSON.stringify({
          kind: 'pacto.mentions.envelope.v1',
          body: 'hi',
          mentions: [],
        }),
      }),
      message({ id: 'a', createdAt: 20, content: 'first of pair' }),
      message({
        id: 'file',
        kind: 15,
        createdAt: 30,
        content: 'https://blob.example/abc',
        tags: [
          ['file-type', 'image/png'],
          ['decryption-key', 'kk'],
          ['decryption-nonce', 'nn'],
        ],
      }),
      message({ id: 'react', kind: 7, createdAt: 50, content: '👍', tags: [['e', 'b']], referenceId: 'b' }),
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.chunks).toHaveLength(1);
    expect(built.chunks[0].messages.map((row) => row.id)).toEqual([
      'mention',
      'a',
      'b',
      'file',
      'react',
    ]);
    const parsed = parseHistoryChunk(JSON.stringify(built.chunks[0]), EXPECTED);
    expect(parsed.ok).toBe(true);
  });

  it('drops a single message that cannot fit in one rumor', () => {
    const huge = buildHistoryChunks(EXPECTED, [message({ content: 'x'.repeat(20_000) })]);
    expect(huge).toEqual({ ok: false, reason: 'empty' });

    const kept = buildHistoryChunks(EXPECTED, [
      message({ id: 'huge', content: 'x'.repeat(20_000) }),
      message({ id: 'small', content: 'ok' }),
    ]);
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.chunks[0].messages.map((row) => row.id)).toEqual(['small']);
  });

  it('keeps the newest 32 chunks and drops reactions whose target was cut', () => {
    const count = HISTORY_CHUNK_MAX_COUNT + 1;
    const newestAt = count;
    const rows: HistoryMessage[] = [
      ...Array.from({ length: count }, (_, index) =>
        message({
          id: index === 0 ? 'oldest' : index === count - 1 ? 'newest' : `m${index}`,
          createdAt: index + 1,
          content: 'y'.repeat(11_000),
        })
      ),
      message({
        id: 'kept-react',
        kind: 7,
        createdAt: newestAt,
        content: '+',
        tags: [['e', 'newest']],
        referenceId: 'newest',
      }),
      message({
        id: 'orphan-react',
        kind: 7,
        createdAt: newestAt,
        content: '+',
        tags: [['e', 'oldest']],
        referenceId: 'oldest',
      }),
    ];

    const built = buildHistoryChunks(EXPECTED, rows);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.chunks.length).toBeLessThanOrEqual(HISTORY_CHUNK_MAX_COUNT);
    expect(built.chunks.length).toBeGreaterThan(0);

    const ids = built.chunks.flatMap((chunk) => chunk.messages.map((row) => row.id));
    expect(ids).toContain('newest');
    expect(ids).toContain('kept-react');
    expect(ids).not.toContain('oldest');
    expect(ids).not.toContain('orphan-react');

    expect(built.chunks.map((chunk) => chunk.index)).toEqual(built.chunks.map((_, index) => index));
    for (const chunk of built.chunks) {
      expect(chunk.messages.length).toBeGreaterThanOrEqual(1);
      expect(chunk.index).toBeLessThan(chunk.total);
      expect(chunk.total).toBe(built.chunks.length);
    }
  });

  it('keeps a reply whose target was cut by the chunk cap', () => {
    const count = HISTORY_CHUNK_MAX_COUNT + 1;
    const rows: HistoryMessage[] = [
      ...Array.from({ length: count }, (_, index) =>
        message({
          id: index === 0 ? 'oldest' : `m${index}`,
          createdAt: index + 1,
          content: 'y'.repeat(11_000),
        })
      ),
      message({
        id: 'reply',
        createdAt: count + 1,
        content: 'answer',
        tags: [['e', 'oldest', '', 'reply']],
        referenceId: 'oldest',
      }),
    ];

    const built = buildHistoryChunks(EXPECTED, rows);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const ids = built.chunks.flatMap((chunk) => chunk.messages.map((row) => row.id));
    expect(ids).not.toContain('oldest');
    expect(ids).toContain('reply');
  });

  it('splits under the rumor cap', () => {
    const built = buildHistoryChunks(EXPECTED, [
      message({ id: 'a', content: 'y'.repeat(8_000) }),
      message({ id: 'b', createdAt: 1_700_000_001, content: 'z'.repeat(8_000) }),
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.chunks.length).toBeGreaterThan(1);
    for (const chunk of built.chunks) {
      expect(new TextEncoder().encode(JSON.stringify(chunk)).length).toBeLessThanOrEqual(
        HISTORY_RUMOR_JSON_MAX_BYTES
      );
      expect(chunk.total).toBe(built.chunks.length);
    }
  });
});

describe('parseHistoryChunk', () => {
  it('accepts the golden vector and a case-insensitive group id', () => {
    expect(parseHistoryChunk(GOLDEN, EXPECTED)).toEqual({
      ok: true,
      chunk: JSON.parse(GOLDEN),
    });
    const mixed = GOLDEN.replace(GROUP, GROUP.toUpperCase());
    const parsed = parseHistoryChunk(mixed, EXPECTED);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.chunk.groupId).toBe(GROUP);
  });

  it('rejects an oversized rumor, an unknown version, a group mismatch, and product JSON', () => {
    expect(parseHistoryChunk('x'.repeat(HISTORY_RUMOR_JSON_MAX_BYTES + 1), EXPECTED)).toEqual({
      ok: false,
      reason: 'oversized',
    });

    const version = JSON.parse(GOLDEN) as { version: number };
    version.version = 2;
    expect(parseHistoryChunk(JSON.stringify(version), EXPECTED)).toEqual({
      ok: false,
      reason: 'version',
    });

    expect(parseHistoryChunk(GOLDEN, { ...EXPECTED, groupId: 'other' })).toEqual({
      ok: false,
      reason: 'group',
    });

    const smuggled = JSON.parse(GOLDEN) as {
      messages: Array<{ content: string }>;
    };
    smuggled.messages[0].content = JSON.stringify({ type: 'governance_updated' });
    expect(parseHistoryChunk(JSON.stringify(smuggled), EXPECTED)).toEqual({
      ok: false,
      reason: 'message',
    });

    const roster = JSON.parse(GOLDEN) as { messages: Array<{ content: string }> };
    roster.messages[0].content = JSON.stringify({ type: 'squad_member_evm_share' });
    expect(parseHistoryChunk(JSON.stringify(roster), EXPECTED)).toEqual({
      ok: false,
      reason: 'message',
    });

    const empty = JSON.parse(GOLDEN) as { messages: unknown[] };
    empty.messages = [];
    expect(parseHistoryChunk(JSON.stringify(empty), EXPECTED)).toEqual({
      ok: false,
      reason: 'message',
    });

    const edit = JSON.parse(GOLDEN) as { messages: Array<{ kind: number }> };
    edit.messages[0].kind = 16;
    expect(parseHistoryChunk(JSON.stringify(edit), EXPECTED)).toEqual({
      ok: false,
      reason: 'message',
    });
  });
});

describe('parseHistoryRequest', () => {
  it('requires a bucket and an attempt in range', () => {
    const request = {
      type: 'history_request',
      version: 1,
      requestId: REQUEST,
      groupId: GROUP,
      bucket: null,
      attempt: 2,
      designatedNpub: 'npub1bob',
    };
    expect(parseHistoryRequest(JSON.stringify(request)).ok).toBe(true);
    const { bucket: _bucket, ...missing } = request;
    expect(parseHistoryRequest(JSON.stringify(missing))).toEqual({ ok: false, reason: 'malformed' });
    expect(parseHistoryRequest(JSON.stringify({ ...request, bucket: 'polls' }))).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(parseHistoryRequest(JSON.stringify({ ...request, attempt: 4 }))).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});

describe('parseHistoryUnavailable', () => {
  it('accepts empty and over_cap for the matching request', () => {
    for (const reason of ['empty', 'over_cap'] as const) {
      const raw = JSON.stringify({
        type: 'history_unavailable',
        version: 1,
        requestId: REQUEST,
        groupId: GROUP,
        reason,
      });
      expect(parseHistoryUnavailable(raw, EXPECTED)).toEqual({
        ok: true,
        unavailable: { type: 'history_unavailable', version: 1, requestId: REQUEST, groupId: GROUP, reason },
      });
    }
    const raw = JSON.stringify({
      type: 'history_unavailable',
      version: 1,
      requestId: REQUEST,
      groupId: 'nope',
      reason: 'empty',
    });
    expect(parseHistoryUnavailable(raw, EXPECTED)).toEqual({ ok: false, reason: 'group' });
  });
});
