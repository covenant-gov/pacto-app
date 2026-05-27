import type { SquadInfraDto } from '$lib/governance/api';
import { describe, expect, it } from 'vitest';
import {
  hatsTreeExplorerUrl,
  normalizeHatIdPathSegment,
  resolveDashboardStructureSummary,
} from './structure-summary';

const pactoGovRow: SquadInfraDto = {
  id: 'pacto-gov-p1',
  parentId: 'p1',
  infraType: 'pacto_gov',
  chain: 'optimism',
  canonicalRef: '298',
  createdAtMs: 1,
  updatedAtMs: 1,
};

describe('normalizeHatIdPathSegment', () => {
  it('accepts decimal strings', () => {
    expect(normalizeHatIdPathSegment('298')).toBe('298');
    expect(normalizeHatIdPathSegment(' 298 ')).toBe('298');
  });

  it('converts hex hat ids to decimal', () => {
    expect(normalizeHatIdPathSegment('0x12a')).toBe('298');
  });

  it('returns null for empty or invalid', () => {
    expect(normalizeHatIdPathSegment('')).toBe(null);
    expect(normalizeHatIdPathSegment('abc')).toBe(null);
    expect(normalizeHatIdPathSegment('0x')).toBe(null);
  });
});

describe('hatsTreeExplorerUrl', () => {
  it('builds explorer URLs like docs trees/{chainId}/{hat}', () => {
    expect(hatsTreeExplorerUrl(10, '298')).toBe('https://app.hatsprotocol.xyz/trees/10/298');
    expect(hatsTreeExplorerUrl(11155111, '0x12a')).toBe(
      'https://app.hatsprotocol.xyz/trees/11155111/298',
    );
  });

  it('returns null when hat id is unusable', () => {
    expect(hatsTreeExplorerUrl(1, 'nope')).toBe(null);
  });
});

describe('resolveDashboardStructureSummary', () => {
  it('returns undefined while hydrating', () => {
    expect(resolveDashboardStructureSummary(undefined)).toBe(undefined);
  });

  it('returns null without pacto gov', () => {
    expect(resolveDashboardStructureSummary(null)).toBe(null);
    expect(
      resolveDashboardStructureSummary({
        ...pactoGovRow,
        infraType: 'standalone_safe',
        canonicalRef: '0xabc',
      }),
    ).toBe(null);
  });

  it('returns summary for pacto_gov', () => {
    const s = resolveDashboardStructureSummary(pactoGovRow);
    expect(s?.treeIdRaw).toBe('298');
    expect(s?.chainIdNumeric).toBe(10);
    expect(s?.chainDisplayName).toBe('Optimism');
    expect(s?.hatsExplorerUrl).toBe('https://app.hatsprotocol.xyz/trees/10/298');
  });
});
