import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  emojiToTwemojiFilename,
  parseMarkdown,
  sanitize,
  formatMessageTimestamp,
  formatMessageContent,
  formatMessageContentWithMentions,
  mentionSanitizeAttributeHook,
} from './message-formatting';
import type { Mention } from '../messaging/mentions';
import type { NostrProfile } from '../api/nostr';

describe('emojiToTwemojiFilename', () => {
  it('returns null for empty input', () => {
    expect(emojiToTwemojiFilename('')).toBeNull();
  });

  it('maps single-codepoint emoji', () => {
    expect(emojiToTwemojiFilename('🌈')).toBe('1f308.svg');
  });

  it('maps flag emoji to hyphenated codepoints', () => {
    expect(emojiToTwemojiFilename('🇺🇸')).toBe('1f1fa-1f1f8.svg');
  });

  it('produces a filename for any non-empty string', () => {
    // The implementation converts codepoints to hex; letters become valid hex filenames.
    expect(emojiToTwemojiFilename('abc')).toBe('61-62-63.svg');
  });
});

describe('parseMarkdown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('escapes plain text when marked is unavailable', () => {
    vi.stubGlobal('window', { marked: undefined });
    expect(parseMarkdown('hello <script>alert(1)</script> world')).toBe(
      'hello &lt;script&gt;alert(1)&lt;/script&gt; world',
    );
  });

  it('returns empty string for non-string input', () => {
    vi.stubGlobal('window', { marked: undefined });
    expect(parseMarkdown(null as unknown as string)).toBe('');
  });

  it('uses marked.parse when available', () => {
    const marked = {
      use: vi.fn(),
      parse: vi.fn().mockReturnValue('<p>parsed</p>'),
    };
    vi.stubGlobal('window', { marked });
    expect(parseMarkdown('hello')).toBe('<p>parsed</p>');
    expect(marked.parse).toHaveBeenCalledWith('hello', { async: false });
  });
});

describe('sanitize', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns empty string for non-string input', () => {
    vi.stubGlobal('window', { DOMPurify: undefined });
    expect(sanitize(null as unknown as string)).toBe('');
  });

  it('escapes when DOMPurify is unavailable', () => {
    vi.stubGlobal('window', { DOMPurify: undefined });
    expect(sanitize('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('delegates to DOMPurify when available', () => {
    const purify = {
      sanitize: vi.fn().mockReturnValue('<p>clean</p>'),
      addHook: vi.fn(),
      removeHook: vi.fn(),
    };
    vi.stubGlobal('window', { DOMPurify: purify });
    expect(sanitize('<p>dirty</p>')).toBe('<p>clean</p>');
    expect(purify.sanitize).toHaveBeenCalledWith('<p>dirty</p>', expect.any(Object));
  });
});

describe('formatMessageTimestamp', () => {
  it('returns empty string for invalid input', () => {
    expect(formatMessageTimestamp('not a date')).toBe('');
  });

  it('formats a valid ISO string', () => {
    const result = formatMessageTimestamp('2024-05-26T23:09:00.000Z');
    expect(result).toMatch(/May 26/);
    expect(result).toMatch(/:\d{2}\s/);
  });

  it('includes year when different from current year', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    const result = formatMessageTimestamp(past.toISOString());
    expect(result).toMatch(/\d{4}/);
  });
});

describe('formatMessageContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createIdentityPurify(): Window['DOMPurify'] {
    return {
      sanitize: vi.fn((dirty: string) => dirty),
      addHook: vi.fn(),
      removeHook: vi.fn(),
    } as unknown as Window['DOMPurify'];
  }

  it('linkifies bare URLs and keeps script tags escaped by DOMPurify', () => {
    const purify = createIdentityPurify();
    vi.stubGlobal('window', { DOMPurify: purify, marked: undefined, twemoji: undefined });
    const input = '<script>alert(1)</script> https://example.com';
    const result = formatMessageContent(input);
    expect(result).toContain('<a href="https://example.com"');
  });

  it('replaces emoji with Twemoji img tags when twemoji is available', () => {
    const twemoji = {
      replace: vi.fn((text: string, cb: (raw: string) => string) => cb(text)),
      convert: { toCodePoint: () => '1f308' },
    };
    const purify = createIdentityPurify();
    vi.stubGlobal('window', { DOMPurify: purify, marked: undefined, twemoji });
    const result = formatMessageContent('hello 🌈');
    expect(result).toContain('class="twemoji"');
    expect(result).toContain('src="/twemoji/svg/1f308.svg"');
  });

  it('keeps URLs inside code and pre tags unlinked', () => {
    const purify = createIdentityPurify();
    const marked = { use: vi.fn(), parse: vi.fn((src: string) => src) };
    vi.stubGlobal('window', { DOMPurify: purify, marked, twemoji: undefined });
    const input = '<code>https://example.com</code>';
    const result = formatMessageContent(input);
    expect(result).toContain('<code>https://example.com</code>');
    expect(result).not.toContain('<a href');
  });

  it('handles malformed unclosed tags gracefully', () => {
    const purify = createIdentityPurify();
    vi.stubGlobal('window', { DOMPurify: purify, marked: undefined, twemoji: undefined });
    const input = '<span https://example.com';
    const result = formatMessageContent(input);
    expect(result).toContain('https://example.com');
  });
});

describe('formatMessageContentWithMentions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createIdentityPurify(): Window['DOMPurify'] {
    return {
      sanitize: vi.fn((dirty: string) => dirty),
      addHook: vi.fn(),
      removeHook: vi.fn(),
    } as unknown as Window['DOMPurify'];
  }

  const ALICE_NPUB = 'npub1alice00000000000000000000000000000000000000000000000';
  const ALICE: Mention = { npub: ALICE_NPUB, alias: 'alice' };
  const ALICE_PROFILE: NostrProfile = { display_name: 'Alice' } as NostrProfile;
  const ALICE_PROFILES = { [ALICE_NPUB]: ALICE_PROFILE };
  const ALICE_ROSTER = [ALICE_NPUB];

  it('renders a mention outside code as a safe span with current display name', () => {
    const purify = createIdentityPurify();
    vi.stubGlobal('window', { DOMPurify: purify, marked: undefined, twemoji: undefined });
    const result = formatMessageContentWithMentions('hello @alice', [ALICE], ALICE_PROFILES, ALICE_ROSTER);
    expect(result).toContain('<span class="mention"');
    expect(result).toContain(`data-npub="${ALICE_NPUB}"`);
    expect(result).toContain('@Alice');
  });

  it('appends a trust signal when resolved name differs from alias', () => {
    const purify = createIdentityPurify();
    const profiles = {
      [ALICE_NPUB]: { display_name: 'Alice Smith', nip05: 'alice@example.com' } as NostrProfile,
    };
    vi.stubGlobal('window', { DOMPurify: purify, marked: undefined, twemoji: undefined });
    const result = formatMessageContentWithMentions('hi @alice', [ALICE], profiles, ALICE_ROSTER);
    expect(result).toContain('@Alice Smith');
    expect(result).toContain('alice@example.com');
  });

  it('keeps a mention inside a code span as literal text', () => {
    const purify = createIdentityPurify();
    const marked = { use: vi.fn(), parse: vi.fn((src: string) => `<p><code>${src}</code></p>`) };
    vi.stubGlobal('window', { DOMPurify: purify, marked, twemoji: undefined });
    const result = formatMessageContentWithMentions('hello `@alice`', [ALICE], ALICE_PROFILES, ALICE_ROSTER);
    expect(result).toContain('<code>');
    expect(result).toContain('@alice');
    expect(result).not.toContain('class="mention"');
  });

  it('keeps a mention inside a pre block as literal text', () => {
    const purify = createIdentityPurify();
    const marked = { use: vi.fn(), parse: vi.fn((src: string) => `<pre><code>${src}</code></pre>`) };
    vi.stubGlobal('window', { DOMPurify: purify, marked, twemoji: undefined });
    const result = formatMessageContentWithMentions('hello @alice', [ALICE], ALICE_PROFILES, ALICE_ROSTER);
    expect(result).toContain('<pre>');
    expect(result).not.toContain('class="mention"');
  });

  it('escapes the resolved alias text and data-npub attribute', () => {
    const purify = createIdentityPurify();
    const evil: Mention = { npub: 'npub1evil"onclick="alert(1)', alias: 'evil' };
    const profiles = { [evil.npub]: { display_name: '<script>alert(1)</script>' } as NostrProfile };
    vi.stubGlobal('window', { DOMPurify: purify, marked: undefined, twemoji: undefined });
    const result = formatMessageContentWithMentions('hi @evil', [evil], profiles, [evil.npub]);
    expect(result).not.toContain('<script>');
    expect(result).toContain('@&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result).toContain('data-npub="npub1evil&quot;onclick=&quot;alert(1)"');
  });

  it('resolves multiple mentions with the same alias by occurrence order', () => {
    const purify = createIdentityPurify();
    const alice1: Mention = { npub: 'npub1alice11111111111111111111111111111111111111111111111', alias: 'alice' };
    const alice2: Mention = { npub: 'npub1alice22222222222222222222222222222222222222222222222', alias: 'alice' };
    const profiles = {
      [alice1.npub]: { display_name: 'Alice' } as NostrProfile,
      [alice2.npub]: { display_name: 'Alice' } as NostrProfile,
    };
    vi.stubGlobal('window', { DOMPurify: purify, marked: undefined, twemoji: undefined });
    const result = formatMessageContentWithMentions('@alice @alice', [alice1, alice2], profiles, [alice1.npub, alice2.npub]);
    expect((result.match(new RegExp(alice1.npub, 'g')) ?? []).length).toBe(1);
    expect(result).toContain(alice2.npub);
  });

  it('renders a non-roster mention as plain text', () => {
    const purify = createIdentityPurify();
    vi.stubGlobal('window', { DOMPurify: purify, marked: undefined, twemoji: undefined });
    const result = formatMessageContentWithMentions('hi @alice', [ALICE], ALICE_PROFILES, []);
    expect(result).toContain('@alice');
    expect(result).not.toContain('class="mention"');
  });
});

describe('mentionSanitizeAttributeHook', () => {
  function fakeNode(tag: string, classAttr: string | null): Element {
    return {
      tagName: tag,
      getAttribute: (name: string) => (name === 'class' ? classAttr : null),
    } as unknown as Element;
  }

  function fakeData(value: string): { attrName: string; attrValue: string; keepAttr: boolean } {
    return { attrName: 'data-npub', attrValue: value, keepAttr: true };
  }

  it('keeps a valid data-npub on a span with class mention', () => {
    const data = fakeData('npub1abc123');
    mentionSanitizeAttributeHook(fakeNode('SPAN', 'mention'), data, {});
    expect(data.keepAttr).toBe(true);
    expect(data.attrValue).toBe('npub1abc123');
  });

  it('rejects data-npub on a span without the mention class', () => {
    const data = fakeData('npub1abc123');
    mentionSanitizeAttributeHook(fakeNode('SPAN', 'other'), data, {});
    expect(data.keepAttr).toBe(false);
  });

  it('rejects data-npub on a non-span element', () => {
    const data = fakeData('npub1abc123');
    mentionSanitizeAttributeHook(fakeNode('DIV', 'mention'), data, {});
    expect(data.keepAttr).toBe(false);
  });

  it('rejects an invalid data-npub value', () => {
    const data = fakeData('evil123');
    mentionSanitizeAttributeHook(fakeNode('SPAN', 'mention'), data, {});
    expect(data.keepAttr).toBe(false);
  });
});
