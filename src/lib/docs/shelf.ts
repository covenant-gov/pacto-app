import type { SquadDocDto } from '../api/squad-docs';

export type DocsFilter = { kind: 'all' } | { kind: 'channel'; channelId: string } | { kind: 'untagged' };

export function filterDocs(rows: SquadDocDto[], filter: DocsFilter): SquadDocDto[] {
  switch (filter.kind) {
    case 'all':
      return rows;
    case 'channel':
      return rows.filter((row) => row.channelId === filter.channelId);
    case 'untagged':
      return rows.filter((row) => !row.channelId);
  }
}

/** Newest `updatedAtMs` first; ties fall back to newest `createdAtMs`. Returns a new array. */
export function sortDocsNewestFirst(rows: SquadDocDto[]): SquadDocDto[] {
  return [...rows].sort((a, b) => b.updatedAtMs - a.updatedAtMs || b.createdAtMs - a.createdAtMs);
}
