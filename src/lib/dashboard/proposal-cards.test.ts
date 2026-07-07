import { describe, expect, it } from 'vitest';
import { buildDashboardProposalCards } from './proposal-cards';

describe('buildDashboardProposalCards', () => {
  it('returns empty when no treasury or pacto gov', () => {
    expect(buildDashboardProposalCards({ treasurySafes: [], governanceConfig: null })).toEqual([]);
    expect(buildDashboardProposalCards({ treasurySafes: [], governanceConfig: undefined })).toEqual([]);
  });

  it('includes pacto_gov when provider matches', () => {
    const cards = buildDashboardProposalCards({
      treasurySafes: [],
      governanceConfig: {
        id: 'infra-1',
        parentId: 'p1',
        provider: 'pacto_gov',
        infraType: 'pacto_gov',
        chain: 'sepolia',
        canonicalRef: '0xabc',
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    });
    expect(cards).toEqual([
      expect.objectContaining({
        tool: 'pacto_gov',
        ref: '0xabc',
        chain: 'sepolia',
      }),
    ]);
  });

  it('maps treasury safes to safe tool rows', () => {
    const cards = buildDashboardProposalCards({
      treasurySafes: [
        {
          id: 't1',
          parentId: 'p1',
          safeAddress: '0x1111',
          chain: 'sepolia',
          label: 'Main',
          createdAtMs: 1,
        },
      ],
      governanceConfig: null,
    });
    expect(cards).toEqual([
      expect.objectContaining({
        tool: 'safe',
        ref: '0x1111',
        chain: 'sepolia',
        treasuryEntryId: 't1',
        title: 'Main',
      }),
    ]);
  });

  it('orders pacto_gov before treasury rows', () => {
    const cards = buildDashboardProposalCards({
      treasurySafes: [
        {
          id: 't1',
          parentId: 'p1',
          safeAddress: '0x2222',
          chain: 'sepolia',
          label: '',
          createdAtMs: 1,
        },
      ],
      governanceConfig: {
        id: 'infra-1',
        parentId: 'p1',
        provider: 'pacto_gov',
        infraType: 'pacto_gov',
        chain: 'sepolia',
        canonicalRef: 'hat',
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    });
    expect(cards.map((c) => c.tool)).toEqual(['pacto_gov', 'safe']);
  });
});
