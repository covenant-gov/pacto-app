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
  chain: 'arbitrum',
  canonicalRef: '298',
  createdAtMs: 1,
  updatedAtMs: 1,
};

describe('normalizeHatIdPathSegment', () => {
  it('accepts decimal strings', () => {
    expect(normalizeHatIdPathSegment('298')).toBe('298');
    expect(normalizeHatIdPathSegment(' 298 ')).toBe('298');
  });

  it('trims whitespace-only strings to null', () => {
    expect(normalizeHatIdPathSegment('   ')).toBe(null);
    expect(normalizeHatIdPathSegment('\t\n')).toBe(null);
  });

  it('accepts uppercase hex and decimal strings', () => {
    expect(normalizeHatIdPathSegment('0x12A')).toBe('298');
    expect(normalizeHatIdPathSegment('000298')).toBe('000298');
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

  it('returns null for non-finite chain ids', () => {
    expect(hatsTreeExplorerUrl(NaN, '298')).toBe(null);
    expect(hatsTreeExplorerUrl(Infinity, '298')).toBe(null);
    expect(hatsTreeExplorerUrl(-Infinity, '0x12a')).toBe(null);
  });

  it('trims whitespace from hat id before normalizing', () => {
    expect(hatsTreeExplorerUrl(10, '  298  ')).toBe('https://app.hatsprotocol.xyz/trees/10/298');
    expect(hatsTreeExplorerUrl(10, '  nope  ')).toBe(null);
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
    expect(s?.chainIdNumeric).toBe(42161);
    expect(s?.chainDisplayName).toBe('Arbitrum');
    expect(s?.hatsExplorerUrl).toBe('https://app.hatsprotocol.xyz/trees/42161/298');
  });

  it('returns summary for local anvil chain', () => {
    const s = resolveDashboardStructureSummary({ ...pactoGovRow, chain: 'local' });
    expect(s?.chainKey).toBe('local');
    expect(s?.chainIdNumeric).toBe(31337);
    expect(s?.chainDisplayName).toBe('Local Anvil');
    expect(s?.hatsExplorerUrl).toBe('https://app.hatsprotocol.xyz/trees/31337/298');
  });

  it('treats the retired "anvil" alias as unknown (falls back to sepolia)', () => {
    const s = resolveDashboardStructureSummary({ ...pactoGovRow, chain: 'anvil' });
    expect(s?.chainKey).toBe('sepolia');
  });

  it('returns null when canonical ref is empty or whitespace', () => {
    expect(resolveDashboardStructureSummary({ ...pactoGovRow, canonicalRef: '' })).toBe(null);
    expect(resolveDashboardStructureSummary({ ...pactoGovRow, canonicalRef: '   ' })).toBe(null);
  });

  it('returns summary for each supported chain', () => {
    const cases: Array<{ chain: string; name: string; id: number }> = [
      { chain: 'mainnet', name: 'Ethereum', id: 1 },
      { chain: 'arbitrum', name: 'Arbitrum', id: 42161 },
      { chain: 'sepolia', name: 'Sepolia', id: 11155111 },
      { chain: 'local', name: 'Local Anvil', id: 31337 },
    ];
    for (const { chain, name, id } of cases) {
      const s = resolveDashboardStructureSummary({ ...pactoGovRow, chain });
      expect(s?.chainKey).toBe(chain as SquadInfraDto['chain']);
      expect(s?.chainDisplayName).toBe(name);
      expect(s?.chainIdNumeric).toBe(id);
      expect(s?.hatsExplorerUrl).toBe(`https://app.hatsprotocol.xyz/trees/${id}/298`);
    }
  });

  it('falls back to sepolia for unknown chain strings', () => {
    const s = resolveDashboardStructureSummary({ ...pactoGovRow, chain: 'unknown' });
    expect(s?.chainKey).toBe('sepolia');
    expect(s?.chainDisplayName).toBe('Sepolia');
    expect(s?.chainIdNumeric).toBe(11155111);
  });
});
