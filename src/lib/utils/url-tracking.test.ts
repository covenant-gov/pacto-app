import { describe, it, expect } from 'vitest';
import {
  extractPreviewHttpsUrls,
  replyQuoteExcerpt,
  stripTrackingParamsFromText,
  stripTrackingParamsFromUrl,
} from './url-tracking';

describe('stripTrackingParamsFromUrl', () => {
  it('drops utm_ parameters and keeps the rest in order', () => {
    expect(stripTrackingParamsFromUrl('https://example.com/a?utm_source=nl&id=1')).toBe(
      'https://example.com/a?id=1',
    );
  });

  it('matches parameter names case-insensitively and keeps spelling of survivors', () => {
    expect(stripTrackingParamsFromUrl('https://example.com/a?id=1&UTM_MEDIUM=x&ok=2')).toBe(
      'https://example.com/a?id=1&ok=2',
    );
  });

  it('drops a dangling question mark when the query becomes empty', () => {
    expect(stripTrackingParamsFromUrl('https://example.com/a?fbclid=abc')).toBe('https://example.com/a');
  });

  it('is idempotent', () => {
    const once = stripTrackingParamsFromUrl('https://example.com/a?utm_source=nl&id=1');
    expect(stripTrackingParamsFromUrl(once)).toBe(once);
  });

  it('does not re-encode surviving values', () => {
    expect(stripTrackingParamsFromUrl('https://example.com/a?id=1&ok=2%7E')).toBe(
      'https://example.com/a?id=1&ok=2%7E',
    );
    expect(stripTrackingParamsFromUrl('https://example.com/a?q=hello+world&gclid=1')).toBe(
      'https://example.com/a?q=hello+world',
    );
  });

  it('drops si only on youtube, youtu.be, and open.spotify.com', () => {
    expect(stripTrackingParamsFromUrl('https://youtu.be/abc?si=track')).toBe('https://youtu.be/abc');
    expect(stripTrackingParamsFromUrl('https://example.com/a?si=1')).toBe('https://example.com/a?si=1');
    expect(stripTrackingParamsFromUrl('https://music.youtube.com/watch?v=1&si=track')).toBe(
      'https://music.youtube.com/watch?v=1',
    );
    expect(stripTrackingParamsFromUrl('https://notyoutube.com/a?si=1')).toBe(
      'https://notyoutube.com/a?si=1',
    );
    expect(stripTrackingParamsFromUrl('https://open.spotify.com/track/1?si=track')).toBe(
      'https://open.spotify.com/track/1',
    );
  });

  it('drops igshid on instagram and keeps it elsewhere', () => {
    expect(stripTrackingParamsFromUrl('https://www.instagram.com/p/1/?igshid=abc')).toBe(
      'https://www.instagram.com/p/1/',
    );
    expect(stripTrackingParamsFromUrl('https://example.com/?igshid=abc')).toBe(
      'https://example.com/?igshid=abc',
    );
    expect(stripTrackingParamsFromUrl('https://www.threads.net/p/1?igshid=abc')).toBe(
      'https://www.threads.net/p/1',
    );
  });

  it('drops ref_src on x.com and keeps it elsewhere', () => {
    expect(stripTrackingParamsFromUrl('https://x.com/a?ref_src=tw&id=1')).toBe('https://x.com/a?id=1');
    expect(stripTrackingParamsFromUrl('https://example.com/a?ref_src=tw')).toBe(
      'https://example.com/a?ref_src=tw',
    );
  });

  it('keeps mkt_tok on unsubscribe paths and drops it otherwise', () => {
    expect(
      stripTrackingParamsFromUrl('https://news.example/unsubscribe?mkt_tok=abc&utm_source=n'),
    ).toBe('https://news.example/unsubscribe?mkt_tok=abc');
    expect(stripTrackingParamsFromUrl('https://news.example/unsub?mkt_tok=abc')).toBe(
      'https://news.example/unsub',
    );
  });

  it('strips form-style fragments and leaves hash routes alone', () => {
    expect(stripTrackingParamsFromUrl('https://example.com/a?id=1#utm_source=n&x=1')).toBe(
      'https://example.com/a?id=1#x=1',
    );
    expect(stripTrackingParamsFromUrl('https://example.com/a#section')).toBe('https://example.com/a#section');
    expect(stripTrackingParamsFromUrl('https://example.com/a#/route')).toBe('https://example.com/a#/route');
  });

  it('returns non-http(s) and malformed URLs unchanged', () => {
    expect(stripTrackingParamsFromUrl('mailto:a@b.com?utm_source=n')).toBe('mailto:a@b.com?utm_source=n');
    expect(stripTrackingParamsFromUrl('https://[bad')).toBe('https://[bad');
  });

  it('does not treat bare utm, ref, or credential names as tracking', () => {
    const url = 'https://example.com/a?utm=1&ref=home&code=abc&id=1';
    expect(stripTrackingParamsFromUrl(url)).toBe(url);
  });
});

describe('stripTrackingParamsFromText', () => {
  it('leaves trailing punctuation outside the URL', () => {
    expect(stripTrackingParamsFromText('see https://example.com?utm_source=n.')).toBe(
      'see https://example.com.',
    );
  });

  it('leaves text without a URL unchanged, including the empty string', () => {
    expect(stripTrackingParamsFromText('hello')).toBe('hello');
    expect(stripTrackingParamsFromText('')).toBe('');
  });
});

describe('extractPreviewHttpsUrls', () => {
  it('keeps a quote that the render regex would stop on, then the stripper drops utm', () => {
    const raw = "https://example.com/a?id=1'&utm_source=n";
    expect(extractPreviewHttpsUrls(raw)).toEqual([raw]);
    expect(stripTrackingParamsFromUrl(raw)).toBe("https://example.com/a?id=1'");
  });
});

describe('replyQuoteExcerpt', () => {
  it('strips then slices when enabled, and leaves the original when disabled', () => {
    const content = 'https://example.com/a?fbclid=abc&id=1';
    const on = replyQuoteExcerpt(content, true);
    expect(on).toContain('id=1');
    expect(on).not.toContain('fbclid');
    expect(replyQuoteExcerpt(content, false)).toContain('fbclid');
  });
});
