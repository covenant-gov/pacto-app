import { describe, expect, it } from 'vitest';
import { hasKeyedSecret, isHttpUrl, maskDocUrl, previewCandidateUrl } from './mask-url';

/** Shared with the Rust suite: [input, maskDocUrl, previewCandidateUrl, hasKeyedSecret]. */
const FIXTURES: [string, string, string, boolean][] = [
  [
    'https://cryptpad.fr/pad/#/2/pad/edit/secret',
    'https://cryptpad.fr/pad/#••••',
    'https://cryptpad.fr/pad/',
    true,
  ],
  ['https://example.com/a?token=abc&x=1', 'https://example.com/a?token=••••&x=1', 'https://example.com/a?x=1', true],
  [
    'https://docs.google.com/document/d/1AbC/edit',
    'https://docs.google.com/document/d/1AbC/edit',
    'https://docs.google.com/document/d/1AbC/edit',
    false,
  ],
  ['https://example.com/a#', 'https://example.com/a#', 'https://example.com/a', false],
  [
    'https://example.com/a?Signature=Zz&x=1#frag',
    'https://example.com/a?Signature=••••&x=1#••••',
    'https://example.com/a?x=1',
    true,
  ],
  ['https://example.com/a?token=', 'https://example.com/a?token=', 'https://example.com/a', false],
  ['https://example.com/a', 'https://example.com/a', 'https://example.com/a', false],
];

describe('shared mask fixtures', () => {
  it.each(FIXTURES)('%s', (input, masked, preview, keyed) => {
    expect(maskDocUrl(input)).toBe(masked);
    expect(previewCandidateUrl(input)).toBe(preview);
    expect(hasKeyedSecret(input)).toBe(keyed);
  });
});

describe('maskDocUrl', () => {
  it('masks tracker values and keeps order and encoding', () => {
    expect(maskDocUrl('https://example.com/a?q=a%20b&utm_source=news&key=K')).toBe(
      'https://example.com/a?q=a%20b&utm_source=••••&key=••••',
    );
  });

  it('returns non-http input unchanged', () => {
    expect(maskDocUrl('ftp://example.com/a#x')).toBe('ftp://example.com/a#x');
    expect(maskDocUrl('not a url')).toBe('not a url');
  });
});

describe('previewCandidateUrl', () => {
  it('strips trackers by default and keeps them when asked', () => {
    const raw = 'https://example.com/a?utm_source=x&code=1&b=2#f';
    expect(previewCandidateUrl(raw)).toBe('https://example.com/a?b=2');
    expect(previewCandidateUrl(raw, { stripTrackers: false })).toBe('https://example.com/a?utm_source=x&b=2');
  });
});

describe('hasKeyedSecret', () => {
  it('ignores trackers alone', () => {
    expect(hasKeyedSecret('https://example.com/a?utm_source=x&fbclid=y')).toBe(false);
  });

  it('is false for non-http input', () => {
    expect(hasKeyedSecret('ftp://example.com/a#x')).toBe(false);
  });
});

describe('isHttpUrl', () => {
  it('accepts http and https absolute URLs only', () => {
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('http://example.com/a')).toBe(true);
    expect(isHttpUrl('ftp://example.com/a')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('/relative')).toBe(false);
  });
});
