import { describe, it, expect } from 'vitest';
import type { NostrProfile } from '../api/nostr';
import {
  shortenNpub,
  getMentionAlias,
  assignMentionAliases,
  parseMentionEnvelope,
  formatMentionEnvelope,
  isMentionEnvelope,
  filterMentionsInText,
} from './mentions';
import type { Mention } from './mentions';

function profileStub(overrides: Partial<NostrProfile>): NostrProfile {
  return {
    id: '',
    name: '',
    avatar: '',
    last_read: '',
    status: { title: '', purpose: '', url: '' },
    last_updated: 0,
    typing_until: 0,
    mine: false,
    display_name: '',
    nickname: '',
    lud06: '',
    lud16: '',
    banner: '',
    about: '',
    website: '',
    nip05: '',
    muted: false,
    bot: false,
    avatar_cached: '',
    banner_cached: '',
    ...overrides,
  };
}

describe('shortenNpub', () => {
  it('leaves short npubs unchanged', () => {
    expect(shortenNpub('npub1abc')).toBe('npub1abc');
  });

  it('truncates long npubs with an ellipsis', () => {
    const long = 'npub1' + 'a'.repeat(100);
    expect(shortenNpub(long)).toBe(long.slice(0, 16) + '…');
    expect(shortenNpub(long).length).toBe(17);
  });
});

describe('getMentionAlias', () => {
  it('prefers nickname over name and display name', () => {
    const p = profileStub({ nickname: 'Ali', name: 'Alice', display_name: 'Alice A' });
    expect(getMentionAlias(p, 'npub1abc')).toBe('Ali');
  });

  it('falls back to name when nickname is absent', () => {
    const p = profileStub({ name: 'Alice', display_name: 'Alice A' });
    expect(getMentionAlias(p, 'npub1abc')).toBe('Alice');
  });

  it('falls back to display_name when nickname and name are absent', () => {
    const p = profileStub({ display_name: 'Alice A' });
    expect(getMentionAlias(p, 'npub1abc')).toBe('Alice');
  });

  it('falls back to a shortened npub when no name is present', () => {
    expect(getMentionAlias(profileStub({}), 'npub1abcdef')).toBe('npub1abcdef'.slice(0, 16));
  });
});

describe('assignMentionAliases', () => {
  it('assigns aliases from profile names', () => {
    const profiles: Record<string, NostrProfile> = {
      npub1: profileStub({ name: 'Alice' }),
      npub2: profileStub({ name: 'Bob' }),
    };
    const map = assignMentionAliases(['npub1', 'npub2'], profiles);
    expect(map.get('npub1')).toBe('Alice');
    expect(map.get('npub2')).toBe('Bob');
  });

  it('deduplicates colliding aliases by appending a short npub suffix', () => {
    const profiles: Record<string, NostrProfile> = {
      npub1alice: profileStub({ name: 'Alice' }),
      npub2alice: profileStub({ name: 'Alice' }),
    };
    const map = assignMentionAliases(['npub1alice', 'npub2alice'], profiles);
    expect(map.get('npub1alice')).toBe('Alice·npub1ali');
    expect(map.get('npub2alice')).toBe('Alice·npub2ali');
    expect(map.get('npub1alice')?.startsWith('Alice·')).toBe(true);
  });
});

describe('parseMentionEnvelope', () => {
  it('returns null for non-JSON content', () => {
    expect(parseMentionEnvelope('hello world')).toBeNull();
  });

  it('returns null for JSON without body or mentions', () => {
    expect(parseMentionEnvelope('{"body":"hi"}')).toBeNull();
  });

  it('parses a valid envelope and trims whitespace', () => {
    const envelope = formatMentionEnvelope('hi @alice', [
      { npub: 'npub1abc', alias: 'alice' },
    ]);
    const parsed = parseMentionEnvelope(`  ${envelope}  `);
    expect(parsed).toEqual({
      body: 'hi @alice',
      mentions: [{ npub: 'npub1abc', alias: 'alice' }],
    });
  });

  it('skips malformed mention entries', () => {
    const parsed = parseMentionEnvelope(
      '{"body":"hi","mentions":[{"npub":"npub1abc","alias":"alice"},{"invalid":true}]}',
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.mentions).toEqual([{ npub: 'npub1abc', alias: 'alice' }]);
  });
});

describe('formatMentionEnvelope', () => {
  it('serializes body and mentions to JSON', () => {
    const mentions: Mention[] = [{ npub: 'npub1abc', alias: 'alice' }];
    const json = formatMentionEnvelope('hello @alice', mentions);
    expect(JSON.parse(json)).toEqual({ body: 'hello @alice', mentions });
  });
});

describe('isMentionEnvelope', () => {
  it('returns true for valid envelopes', () => {
    expect(isMentionEnvelope(formatMentionEnvelope('hi', []))).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(isMentionEnvelope('plain text')).toBe(false);
  });
});

describe('filterMentionsInText', () => {
  it('keeps mentions whose alias appears in the body', () => {
    const mentions: Mention[] = [
      { npub: 'npub1', alias: 'alice' },
      { npub: 'npub2', alias: 'bob' },
    ];
    expect(filterMentionsInText('hello @alice', mentions)).toEqual([
      { npub: 'npub1', alias: 'alice' },
    ]);
  });

  it('requires a word boundary before and after the alias', () => {
    const mentions: Mention[] = [{ npub: 'npub1', alias: 'alice' }];
    expect(filterMentionsInText('hello @aliceX', mentions)).toEqual([]);
    expect(filterMentionsInText('helloX@alice', mentions)).toEqual([]);
  });

  it('deduplicates mentions with the same alias', () => {
    const mentions: Mention[] = [
      { npub: 'npub1', alias: 'alice' },
      { npub: 'npub2', alias: 'alice' },
    ];
    expect(filterMentionsInText('@alice', mentions)).toHaveLength(1);
  });
});
