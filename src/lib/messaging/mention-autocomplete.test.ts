import { describe, it, expect } from 'vitest';
import {
  buildMentionCandidates,
  filterMentionCandidates,
  findActiveAtTrigger,
  replaceAtTrigger,
  mentionAliasPattern,
  type MentionCandidate,
} from './mention-autocomplete';
import type { NostrProfile } from '../api/nostr';

const ALICE_NPUB = 'npub1alice00000000000000000000000000000000000000000000000';
const BOB_NPUB = 'npub1bob0000000000000000000000000000000000000000000000000';

function profile(nickname?: string, name?: string, nip05?: string, avatar?: string): NostrProfile {
  return {
    id: ALICE_NPUB,
    nickname,
    name,
    nip05,
    avatar: avatar ?? '',
    display_name: undefined,
  } as unknown as NostrProfile;
}

describe('buildMentionCandidates', () => {
  it('uses nickname as alias when present', () => {
    const candidates = buildMentionCandidates([ALICE_NPUB], { [ALICE_NPUB]: profile('Ali') });
    expect(candidates).toEqual([
      {
        npub: ALICE_NPUB,
        alias: 'Ali',
        displayName: 'Ali',
        trustSignal: '',
        avatar: null,
      },
    ]);
  });

  it('falls back to shortened npub when no profile', () => {
    const candidates = buildMentionCandidates([BOB_NPUB], {});
    expect(candidates[0].alias).toBe(`${BOB_NPUB.slice(0, 8)}${BOB_NPUB.slice(-4)}`);
    expect(candidates[0].displayName).toBe(`${BOB_NPUB.slice(0, 8)}…${BOB_NPUB.slice(-4)}`);
  });

  it('trust signal uses nip05 when available', () => {
    const candidates = buildMentionCandidates([ALICE_NPUB], { [ALICE_NPUB]: profile('Ali', undefined, 'alice@example.com') });
    expect(candidates[0].trustSignal).toBe('alice@example.com');
  });

  it('extracts avatar URL from profile', () => {
    const url = 'https://example.com/avatar.png';
    const candidates = buildMentionCandidates([ALICE_NPUB], { [ALICE_NPUB]: profile('Ali', undefined, undefined, url) });
    expect(candidates[0].avatar).toBe(url);
  });

  it('deduplicates npubs and excludes excluded set', () => {
    const candidates = buildMentionCandidates([ALICE_NPUB, ALICE_NPUB, BOB_NPUB], {}, new Set([BOB_NPUB]));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].npub).toBe(ALICE_NPUB);
  });
});

describe('filterMentionCandidates', () => {
  const alice: MentionCandidate = {
    npub: ALICE_NPUB,
    alias: 'alice',
    displayName: 'Alice',
    trustSignal: 'alice@example.com',
    avatar: null,
  };
  const bob: MentionCandidate = {
    npub: BOB_NPUB,
    alias: 'bob',
    displayName: 'Bob',
    trustSignal: '',
    avatar: null,
  };
  const alex: MentionCandidate = {
    npub: 'npub1alex00000000000000000000000000000000000000000000000',
    alias: 'alex',
    displayName: 'Alex',
    trustSignal: '',
    avatar: null,
  };

  it('matches by alias', () => {
    expect(filterMentionCandidates([alice, bob], 'ali')).toEqual([alice]);
  });

  it('matches by display name', () => {
    expect(filterMentionCandidates([alice, bob], 'Bo')).toEqual([bob]);
  });

  it('matches by shortened npub', () => {
    expect(filterMentionCandidates([bob], BOB_NPUB.slice(0, 8))).toEqual([bob]);
  });

  it('returns all candidates when query is empty', () => {
    expect(filterMentionCandidates([alice, bob], '')).toEqual([alice, bob]);
  });

  it('limits results', () => {
    expect(filterMentionCandidates([alice, bob, alex], '', 2)).toHaveLength(2);
  });
});

describe('findActiveAtTrigger', () => {
  it('detects @ at word boundary', () => {
    const value = 'hello @al';
    const trigger = findActiveAtTrigger(value, value.length);
    expect(trigger).toEqual({ query: 'al', start: 6, end: 9 });
  });

  it('returns null when @ is inside a word', () => {
    const value = 'email@example.com';
    expect(findActiveAtTrigger(value, value.length)).toBeNull();
  });

  it('returns null after a space has passed the trigger', () => {
    const value = '@al more text';
    expect(findActiveAtTrigger(value, value.length)).toBeNull();
  });

  it('detects trigger in middle of text', () => {
    const value = 'hey @bo how are you';
    const trigger = findActiveAtTrigger(value, 7);
    expect(trigger).toEqual({ query: 'bo', start: 4, end: 7 });
  });

  it('returns empty query right after @', () => {
    const value = 'hi @';
    const trigger = findActiveAtTrigger(value, value.length);
    expect(trigger).toEqual({ query: '', start: 3, end: 4 });
  });
});

describe('replaceAtTrigger', () => {
  it('replaces trigger with alias and returns new cursor', () => {
    const value = 'hello @al world';
    const trigger = { start: 6, end: 9 };
    const result = replaceAtTrigger(value, trigger, 'alice');
    expect(result.value).toBe('hello @alice world');
    expect(result.cursor).toBe(12);
  });
});

describe('mentionAliasPattern', () => {
  it('matches aliases as whole tokens', () => {
    const pattern = mentionAliasPattern(['alice', 'bob']);
    expect(pattern).not.toBeNull();
    const text = 'hello @alice there @bob done';
    const matches = Array.from(text.matchAll(pattern!)).map((m) => m[2]);
    expect(matches).toEqual(['alice', 'bob']);
  });

  it('returns null for empty aliases', () => {
    expect(mentionAliasPattern([])).toBeNull();
  });
});
