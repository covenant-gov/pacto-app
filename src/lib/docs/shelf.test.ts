import { describe, expect, it } from 'vitest';
import type { SquadDocDto } from '../api/squad-docs';
import { filterDocs, sortDocsNewestFirst } from './shelf';

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

const rows = [doc('a', { channelId: 'general' }), doc('b'), doc('c', { channelId: 'dev' })];

describe('filterDocs', () => {
  it('all returns every row', () => {
    expect(filterDocs(rows, { kind: 'all' }).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('channel keeps only that channel', () => {
    expect(filterDocs(rows, { kind: 'channel', channelId: 'general' }).map((r) => r.id)).toEqual(['a']);
  });

  it('untagged excludes a general-tagged row', () => {
    expect(filterDocs(rows, { kind: 'untagged' }).map((r) => r.id)).toEqual(['b']);
  });
});

describe('sortDocsNewestFirst', () => {
  it('puts the newest updated row first without mutating input', () => {
    const input = [
      doc('old', { updatedAtMs: 10 }),
      doc('new', { updatedAtMs: 30 }),
      doc('mid', { updatedAtMs: 20 }),
    ];
    expect(sortDocsNewestFirst(input).map((r) => r.id)).toEqual(['new', 'mid', 'old']);
    expect(input[0].id).toBe('old');
  });
});
