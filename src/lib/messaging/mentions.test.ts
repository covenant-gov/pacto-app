import { describe, it, expect } from 'vitest';
import {
  parseMessageContent,
  buildMentionEnvelope,
  isMentionEnvelopeContent,
  filterMentionsByRoster,
  type Mention,
} from './mentions';

const VALID_BODY = 'hello @alice and @bob';
const ALICE_MENTION: Mention = { npub: 'npub1alice00000000000000000000000000000000000000000000000', alias: 'alice' };
const BOB_MENTION: Mention = { npub: 'npub1bob0000000000000000000000000000000000000000000000000', alias: 'bob' };

function envelope(body: string, mentions: Mention[], bucket = 'announcements') {
  return {
    kind: 'pacto.mentions.envelope.v1',
    body,
    mentions,
    pacto_virtual_bucket: bucket,
  };
}

describe('mentions envelope', () => {
  it('parses a valid envelope', () => {
    const content = JSON.stringify(envelope(VALID_BODY, [ALICE_MENTION, BOB_MENTION], 'polls'));
    const parsed = parseMessageContent(content);
    expect(parsed.isEnvelope).toBe(true);
    expect(parsed.body).toBe(VALID_BODY);
    expect(parsed.mentions).toEqual([ALICE_MENTION, BOB_MENTION]);
    expect(parsed.pacto_virtual_bucket).toBe('polls');
  });

  it('builds JSON envelope with correct fields', () => {
    const json = buildMentionEnvelope(VALID_BODY, [ALICE_MENTION], 'inbox');
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(envelope(VALID_BODY, [ALICE_MENTION], 'inbox'));
  });

  it('treats non-JSON content as plain text', () => {
    const content = 'just plain text';
    const parsed = parseMessageContent(content);
    expect(parsed.isEnvelope).toBe(false);
    expect(parsed.body).toBe(content);
    expect(parsed.mentions).toEqual([]);
    expect(parsed.pacto_virtual_bucket).toBeNull();
  });

  it('treats JSON with schema/type keys as plain text', () => {
    const content = JSON.stringify({ schema: 'pacto.squad.bot_join_response.v1', status: 'accepted' });
    const parsed = parseMessageContent(content);
    expect(parsed.isEnvelope).toBe(false);
    expect(parsed.body).toBe(content);
  });

  it('treats JSON with wrong kind as plain text', () => {
    const content = JSON.stringify({ kind: 'pacto.other.v1', body: 'hi', mentions: [], pacto_virtual_bucket: 'x' });
    const parsed = parseMessageContent(content);
    expect(parsed.isEnvelope).toBe(false);
    expect(parsed.body).toBe(content);
  });

  it('treats malformed JSON as plain text', () => {
    const content = '{"kind": "pacto.mentions.envelope.v1"';
    const parsed = parseMessageContent(content);
    expect(parsed.isEnvelope).toBe(false);
    expect(parsed.body).toBe(content);
  });

  it('falls back to raw content when envelope fields have wrong types', () => {
    const content = JSON.stringify({ kind: 'pacto.mentions.envelope.v1', body: 123, mentions: 'none' });
    const parsed = parseMessageContent(content);
    expect(parsed.isEnvelope).toBe(false);
    expect(parsed.body).toBe(content);
  });

  it('falls back to raw content when a mention entry is malformed', () => {
    const content = JSON.stringify({
      kind: 'pacto.mentions.envelope.v1',
      body: 'hi',
      mentions: [{ npub: 'npub1alice', alias: 'alice' }, { alias: 'no-npub' }],
    });
    const parsed = parseMessageContent(content);
    expect(parsed.isEnvelope).toBe(false);
  });

  it('allows missing pacto_virtual_bucket and returns null', () => {
    const content = JSON.stringify({ kind: 'pacto.mentions.envelope.v1', body: 'hi', mentions: [ALICE_MENTION] });
    const parsed = parseMessageContent(content);
    expect(parsed.isEnvelope).toBe(true);
    expect(parsed.pacto_virtual_bucket).toBeNull();
  });

  it('isMentionEnvelopeContent returns true only for valid envelopes', () => {
    expect(isMentionEnvelopeContent(JSON.stringify(envelope('hi', [ALICE_MENTION])))).toBe(true);
    expect(isMentionEnvelopeContent('plain')).toBe(false);
    expect(isMentionEnvelopeContent('{"kind":"pacto.mentions.envelope.v1"}')).toBe(false);
  });
});

describe('filterMentionsByRoster', () => {
  it('keeps only mentions whose npub is in the roster', () => {
    const mentions = [ALICE_MENTION, BOB_MENTION];
    const filtered = filterMentionsByRoster(mentions, [ALICE_MENTION.npub]);
    expect(filtered).toEqual([ALICE_MENTION]);
  });

  it('accepts a Set as roster', () => {
    const mentions = [ALICE_MENTION, BOB_MENTION];
    const set = new Set([BOB_MENTION.npub]);
    expect(filterMentionsByRoster(mentions, set)).toEqual([BOB_MENTION]);
  });

  it('returns empty when roster is empty', () => {
    expect(filterMentionsByRoster([ALICE_MENTION], [])).toEqual([]);
  });

  it('does not generate a self-mention highlight when current user is not in roster', () => {
    const currentUserNpub = ALICE_MENTION.npub;
    const parsed = parseMessageContent(buildMentionEnvelope('hi @bob', [BOB_MENTION], 'announcements'));
    const filtered = filterMentionsByRoster(parsed.mentions, [BOB_MENTION.npub]);
    const isMentioned = filtered.some((m) => m.npub === currentUserNpub);
    expect(isMentioned).toBe(false);
  });

  it('generates a self-mention highlight when current user is in filtered roster', () => {
    const currentUserNpub = ALICE_MENTION.npub;
    const parsed = parseMessageContent(buildMentionEnvelope('hi @alice', [ALICE_MENTION], 'announcements'));
    const filtered = filterMentionsByRoster(parsed.mentions, [ALICE_MENTION.npub]);
    const isMentioned = filtered.some((m) => m.npub === currentUserNpub);
    expect(isMentioned).toBe(true);
  });

  it('extracts reply preview body from a mention envelope', () => {
    const parsed = parseMessageContent(buildMentionEnvelope('reply body @alice', [ALICE_MENTION], 'announcements'));
    expect(parsed.body).toBe('reply body @alice');
    expect(parsed.isEnvelope).toBe(true);
  });
});
