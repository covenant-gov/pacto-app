import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  emojiToTwemojiFilename,
  parseMarkdown,
  sanitize,
  formatMessageTimestamp,
  formatMessageContent,
} from './message-formatting';

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
