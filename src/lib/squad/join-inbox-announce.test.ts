import { describe, expect, it } from 'vitest';
import { parseJoinInboxAnnounceMessage, shortNpub } from './join-inbox-announce';
import { JOIN_INBOX_KEY_ROTATED_SCHEMA, JOIN_INBOX_META_SCHEMA } from './join-inbox';

describe('parseJoinInboxAnnounceMessage', () => {
  it('parses meta', () => {
    const raw = JSON.stringify({
      schema: JOIN_INBOX_META_SCHEMA,
      squadId: 's1',
      inboxNpub: 'npub1328t8fz60tmg5yg3pa8uwes5vcczwgs3t5utwxflagpgag5965ms7r0ulm',
      holders: ['npub1a', 'npub1b'],
      keyEpoch: 2,
      updatedAt: 10,
    });
    const parsed = parseJoinInboxAnnounceMessage(raw);
    expect(parsed).toEqual({
      kind: 'meta',
      payload: {
        squadId: 's1',
        inboxNpub: 'npub1328t8fz60tmg5yg3pa8uwes5vcczwgs3t5utwxflagpgag5965ms7r0ulm',
        holders: ['npub1a', 'npub1b'],
        keyEpoch: 2,
        updatedAt: 10,
      },
    });
  });

  it('parses key rotated', () => {
    const raw = JSON.stringify({
      schema: JOIN_INBOX_KEY_ROTATED_SCHEMA,
      squadId: 's1',
      inboxNpub: 'npub1inbox',
      keyEpoch: 3,
      rotatedByNpub: 'npub1alice',
      updatedAt: 11,
    });
    const parsed = parseJoinInboxAnnounceMessage(raw);
    expect(parsed?.kind).toBe('key_rotated');
  });

  it('rejects legacy squad_bot schema and invalid payloads', () => {
    expect(
      parseJoinInboxAnnounceMessage(
        JSON.stringify({
          schema: 'pacto.squad_bot.meta.v1',
          squadId: 's1',
          botNpub: 'npub1inbox',
          holders: ['npub1a'],
          keyEpoch: 1,
          updatedAt: 1,
        })
      )
    ).toBeNull();
    expect(parseJoinInboxAnnounceMessage('{"type":"governance_updated","payload":{}}')).toBeNull();
    expect(parseJoinInboxAnnounceMessage('hello')).toBeNull();
  });
});

describe('shortNpub', () => {
  it('truncates long npubs', () => {
    const n = 'npub1abcdefghijklmnopqrstuvwxyz0123456789';
    expect(shortNpub(n).includes('…')).toBe(true);
    expect(shortNpub('npub1short')).toBe('npub1short');
  });
});
