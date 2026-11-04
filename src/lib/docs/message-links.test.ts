import { describe, expect, it } from 'vitest';
import type { SquadDocDto } from '../api/squad-docs';
import { defaultDocTitle, docIdentityKey, extractMessageDocLinks, findExistingDoc } from './message-links';

function doc(id: string, fields: Partial<SquadDocDto> = {}): SquadDocDto {
  return {
    id,
    parentId: 'p',
    mlsGroupId: 'g',
    url: `https://example.com/${id}`,
    title: id,
    provider: 'other',
    channelId: null,
    note: null,
    authorNpub: 'npub1a',
    createdAtMs: 0,
    updatedAtMs: 0,
    updatedByNpub: 'npub1a',
    canEdit: false,
    ...fields,
  };
}

describe('extractMessageDocLinks', () => {
  it('returns none for text without links', () => {
    expect(extractMessageDocLinks('no links here')).toEqual([]);
    expect(extractMessageDocLinks('ftp://example.com/a')).toEqual([]);
  });

  it('returns one bare link without trailing punctuation', () => {
    expect(extractMessageDocLinks('see http://example.com/a.')).toEqual([{ url: 'http://example.com/a', label: null }]);
  });

  it('returns two links in order', () => {
    expect(extractMessageDocLinks('https://cryptpad.fr/pad/#/2/x and https://docs.google.com/d/1')).toEqual([
      { url: 'https://cryptpad.fr/pad/#/2/x', label: null },
      { url: 'https://docs.google.com/d/1', label: null },
    ]);
  });

  it('dedups the same link within a message', () => {
    expect(extractMessageDocLinks('https://example.com/a https://example.com/a?utm_source=x')).toEqual([
      { url: 'https://example.com/a', label: null },
    ]);
  });

  it('uses markdown link text as the label when it differs from the URL', () => {
    expect(extractMessageDocLinks('read [Meeting notes](https://example.com/notes) now')).toEqual([
      { url: 'https://example.com/notes', label: 'Meeting notes' },
    ]);
    expect(extractMessageDocLinks('[https://example.com/a](https://example.com/a)')).toEqual([
      { url: 'https://example.com/a', label: null },
    ]);
  });

  it('keeps the label when the bare link comes first', () => {
    expect(extractMessageDocLinks('https://example.com/a or [Plan](https://example.com/a)')).toEqual([
      { url: 'https://example.com/a', label: 'Plan' },
    ]);
  });

  it('drops a label that contains the URL fragment', () => {
    const url = 'https://cryptpad.fr/pad/#/2/pad/edit/KEY';
    const [link] = extractMessageDocLinks(`[cryptpad.fr/pad/#/2/pad/edit/KEY](${url})`);
    expect(link).toEqual({ url, label: null });
    expect(defaultDocTitle(link)).toBe('cryptpad.fr');
  });

  it('drops a label that contains a secret query value', () => {
    const url = 'https://example.com/a?x=1&token=s3cr3t';
    const [link] = extractMessageDocLinks(`[Doc s3cr3t](${url})`);
    expect(link).toEqual({ url, label: null });
    expect(defaultDocTitle(link)).toBe('example.com');
  });

  it('keeps a harmless label on a keyed URL', () => {
    const url = 'https://cryptpad.fr/pad/#/2/pad/edit/KEY?token=abc';
    expect(extractMessageDocLinks(`[Team pad](${url})`)).toEqual([{ url, label: 'Team pad' }]);
  });
});

describe('defaultDocTitle', () => {
  it('prefers the label, else the hostname', () => {
    expect(defaultDocTitle({ url: 'https://docs.google.com/d/1', label: 'Budget' })).toBe('Budget');
    expect(defaultDocTitle({ url: 'https://docs.google.com/d/1', label: null })).toBe('docs.google.com');
  });
});

describe('docIdentityKey', () => {
  it('is equal for the same full URL', () => {
    expect(docIdentityKey('https://cryptpad.fr/pad/#/2/x')).toBe(docIdentityKey('https://cryptpad.fr/pad/#/2/x'));
  });

  it('differs when the fragment differs', () => {
    expect(docIdentityKey('https://cryptpad.fr/pad/#/2/x')).not.toBe(docIdentityKey('https://cryptpad.fr/pad/#/2/y'));
  });

  it('ignores secret and tracker query pairs and host case', () => {
    const base = docIdentityKey('https://example.com/a?x=1');
    expect(docIdentityKey('https://EXAMPLE.com/a?token=abc&x=1')).toBe(base);
    expect(docIdentityKey('https://example.com/a?x=1&utm_source=news&fbclid=z')).toBe(base);
    expect(docIdentityKey('https://example.com/a?x=2')).not.toBe(base);
  });
});

describe('findExistingDoc', () => {
  const rows = [doc('a', { url: 'https://cryptpad.fr/pad/#/2/x' }), doc('b', { url: 'https://example.com/b?x=1' })];

  it('matches by identity key', () => {
    expect(findExistingDoc(rows, 'https://cryptpad.fr/pad/#/2/x')?.id).toBe('a');
    expect(findExistingDoc(rows, 'https://example.com/b?x=1&utm_source=q')?.id).toBe('b');
  });

  it('returns null for a different fragment or unknown URL', () => {
    expect(findExistingDoc(rows, 'https://cryptpad.fr/pad/#/2/y')).toBeNull();
    expect(findExistingDoc(rows, 'https://other.example/a')).toBeNull();
  });
});
