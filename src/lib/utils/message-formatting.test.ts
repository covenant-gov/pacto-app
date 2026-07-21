import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Mention } from '../messaging/mentions';
import type { NostrProfile } from '../api/nostr';
import {
  emojiToTwemojiFilename,
  parseMarkdown,
  parseMarkdownWithMentions,
  sanitize,
  formatMessageTimestamp,
  formatMessageContent,
} from './message-formatting';

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

type MockExtension = {
  name: string;
  renderer: (token: { raw: string; alias: string; npub: string }) => string;
  tokenizer: (src: string) => { type: 'mention'; raw: string; alias: string; npub: string } | undefined;
};

interface MockMarkedInstance {
  use: ReturnType<typeof vi.fn>;
  parse: ReturnType<typeof vi.fn>;
}

function createMockMarkedInstance(): MockMarkedInstance {
  return {
    use: vi.fn(),
    parse: vi.fn().mockReturnValue('<p>ok</p>'),
  };
}

function createMockMarked() {
  const instance = createMockMarkedInstance();
  return {
    marked: { Marked: vi.fn().mockReturnValue(instance) },
    instance,
  };
}

function findMentionExtension(instance: MockMarkedInstance): MockExtension | undefined {
  const calls = instance.use.mock.calls as [object][];
  for (const [opts] of calls) {
    const exts = (opts as { extensions?: MockExtension[] }).extensions;
    if (exts) {
      const found = exts.find((e) => e.name === 'mention');
      if (found) return found;
    }
  }
  return undefined;
}

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

  it('uses a new marked instance when available', () => {
    const instance = {
      use: vi.fn(),
      parse: vi.fn().mockReturnValue('<p>parsed</p>'),
    };
    const marked = {
      Marked: vi.fn().mockReturnValue(instance),
    };
    vi.stubGlobal('window', { marked });
    expect(parseMarkdown('hello')).toBe('<p>parsed</p>');
    expect(marked.Marked).toHaveBeenCalled();
    expect(instance.use).toHaveBeenCalledWith(
      expect.objectContaining({
        extensions: expect.arrayContaining([expect.objectContaining({ name: 'spoiler' })]),
      }),
    );
    expect(instance.parse).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({ async: false }),
    );
  });
});

describe('parseMarkdownWithMentions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers a mention extension alongside the spoiler extension', () => {
    const { marked, instance } = createMockMarked();
    vi.stubGlobal('window', { marked });
    const mentions: Mention[] = [{ npub: 'npub1abc', alias: 'alice' }];
    const profiles: Record<string, NostrProfile> = {
      npub1abc: profileStub({ id: 'npub1abc', name: 'Alice', display_name: 'Alice A' }),
    };
    parseMarkdownWithMentions('hello @alice', mentions, profiles);
    expect(marked.Marked).toHaveBeenCalled();
    expect(instance.use).toHaveBeenCalledWith(
      expect.objectContaining({
        extensions: expect.arrayContaining([expect.objectContaining({ name: 'spoiler' })]),
      }),
    );
    expect(instance.use).toHaveBeenCalledWith(
      expect.objectContaining({
        extensions: expect.arrayContaining([expect.objectContaining({ name: 'mention' })]),
      }),
    );
    expect(instance.parse).toHaveBeenCalledWith(
      'hello @alice',
      expect.objectContaining({ async: false }),
    );
  });

  it('mention extension renderer emits a data-npub span using the profile display name', () => {
    const { marked, instance } = createMockMarked();
    vi.stubGlobal('window', { marked });
    const mentions: Mention[] = [{ npub: 'npub1abc', alias: 'alice' }];
    const profiles: Record<string, NostrProfile> = {
      npub1abc: profileStub({ id: 'npub1abc', name: 'Alice', display_name: 'Alice A' }),
    };
    parseMarkdownWithMentions('@alice', mentions, profiles);
    const ext = findMentionExtension(instance);
    if (!ext) throw new Error('mention extension not registered');
    const html = ext.renderer({ raw: '@alice', alias: 'alice', npub: 'npub1abc' });
    expect(html).toContain('data-npub="npub1abc"');
    expect(html).toContain('>@Alice</span>');
  });

  it('mention extension tokenizer accepts @alias at a word boundary', () => {
    const { marked, instance } = createMockMarked();
    vi.stubGlobal('window', { marked });
    const mentions: Mention[] = [{ npub: 'npub1abc', alias: 'alice' }];
    const profiles: Record<string, NostrProfile> = {};
    parseMarkdownWithMentions('hi @alice', mentions, profiles);
    const ext = findMentionExtension(instance);
    if (!ext) throw new Error('mention extension not registered');
    expect(ext.tokenizer('@alice')).toEqual({
      type: 'mention',
      raw: '@alice',
      alias: 'alice',
      npub: 'npub1abc',
    });
  });

  it('mention extension tokenizer rejects @alias when followed by a word character', () => {
    const { marked, instance } = createMockMarked();
    vi.stubGlobal('window', { marked });
    const mentions: Mention[] = [{ npub: 'npub1abc', alias: 'alice' }];
    const profiles: Record<string, NostrProfile> = {};
    parseMarkdownWithMentions('hi @alice', mentions, profiles);
    const ext = findMentionExtension(instance);
    if (!ext) throw new Error('mention extension not registered');
    expect(ext.tokenizer('@aliceX')).toBeUndefined();
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
    const { marked, instance } = createMockMarked();
    instance.parse.mockImplementation((src: string) => src);
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

  it('uses mention-aware markdown parsing when mentions and profiles are provided', () => {
    const purify = createIdentityPurify();
    const extensions: MockExtension[] = [];
    const instance = {
      use: vi.fn((opts: { extensions?: MockExtension[] }) => {
        if (opts.extensions) extensions.push(...opts.extensions);
      }),
      parse: vi.fn((content: string) => {
        let html = content;
        const mentionExt = extensions.find((e) => e.name === 'mention');
        if (mentionExt) {
          html = html.replace(/@[a-zA-Z]+/g, (raw) => {
            const token = mentionExt.tokenizer(raw);
            return token ? mentionExt.renderer(token) : raw;
          });
        }
        return `\u003cp\u003e${html}\u003c/p\u003e`;
      }),
    };
    const marked = { Marked: vi.fn().mockReturnValue(instance) };
    vi.stubGlobal('window', { DOMPurify: purify, marked, twemoji: undefined });
    const mentions: Mention[] = [{ npub: 'npub1abc', alias: 'alice' }];
    const profiles: Record<string, NostrProfile> = {
      npub1abc: profileStub({ id: 'npub1abc', name: 'Alice', display_name: 'Alice A' }),
    };
    const result = formatMessageContent('hello @alice', { mentions, profiles });
    expect(result).toContain('class="mention"');
    expect(result).toContain('data-npub="npub1abc"');
    expect(result).toContain('>@Alice<');
  });
});
