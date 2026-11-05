import { describe, expect, it } from 'vitest';
import { docProviderFromUrl } from './provider';

describe('docProviderFromUrl', () => {
  it.each([
    ['https://cryptpad.fr/pad/#/2/pad/edit/x', 'cryptpad'],
    ['https://pad.CryptPad.org/code/', 'cryptpad'],
    ['https://docs.google.com/document/d/1AbC/edit', 'google'],
    ['https://drive.google.com/file/d/1/view', 'google'],
    ['https://writer.zoho.com/writer/open/abc', 'zoho'],
    ['https://www.notion.so/team/Page-123', 'notion'],
    ['https://etherpad.wikimedia.org/p/notes', 'etherpad'],
    ['https://example.com/a', 'other'],
    ['not a url', 'other'],
  ])('%s → %s', (url, provider) => {
    expect(docProviderFromUrl(url)).toBe(provider);
  });
});
