import { describe, expect, it } from 'vitest';
import { buildDashboardProposalCards, dashboardProposalToolLabel } from './proposal-cards';

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

  it('skips pacto_gov when canonical ref is empty or whitespace', () => {
    expect(
      buildDashboardProposalCards({
        treasurySafes: [],
        governanceConfig: {
          id: 'infra-1',
          parentId: 'p1',
          provider: 'pacto_gov',
          infraType: 'pacto_gov',
          chain: 'sepolia',
          canonicalRef: '',
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      }),
    ).toEqual([]);
    expect(
      buildDashboardProposalCards({
        treasurySafes: [],
        governanceConfig: {
          id: 'infra-1',
          parentId: 'p1',
          provider: 'pacto_gov',
          infraType: 'pacto_gov',
          chain: 'sepolia',
          canonicalRef: '   ',
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      }),
    ).toEqual([]);
  });

  it('pacto_gov card tolerates a missing chain', () => {
    const cards = buildDashboardProposalCards({
      treasurySafes: [],
      governanceConfig: {
        id: 'infra-1',
        parentId: 'p1',
        provider: 'pacto_gov',
        infraType: 'pacto_gov',
        // @ts-expect-error exercise optional chain handling a missing chain
        chain: undefined,
        canonicalRef: '0xabc',
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    });
    expect(cards).toEqual([
      expect.objectContaining({
        tool: 'pacto_gov',
        ref: '0xabc',
        chain: undefined,
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

  it('trims whitespace from safe chain and label and falls back title', () => {
    const cards = buildDashboardProposalCards({
      treasurySafes: [
        {
          id: 't2',
          parentId: 'p1',
          safeAddress: ' 0x2222 ',
          chain: '  sepolia  ',
          label: '',
          createdAtMs: 1,
        },
        {
          id: 't3',
          parentId: 'p1',
          safeAddress: '0x3333',
          chain: 'mainnet',
          label: '  ',
          createdAtMs: 1,
        },
      ],
      governanceConfig: null,
    });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual(
      expect.objectContaining({
        tool: 'safe',
        ref: '0x2222',
        chain: 'sepolia',
        treasuryEntryId: 't2',
        title: 'Safe multisig',
      }),
    );
    expect(cards[1]).toEqual(
      expect.objectContaining({
        tool: 'safe',
        ref: '0x3333',
        chain: 'mainnet',
        treasuryEntryId: 't3',
        title: 'Safe multisig',
      }),
    );
  });

  it('handles missing treasury safes list and optional safe fields', () => {
    const cards = buildDashboardProposalCards({
      // @ts-expect-error exercise nullish coalescing when the array is omitted
      treasurySafes: undefined,
      governanceConfig: null,
    });
    expect(cards).toEqual([]);

    const withMissingFields = buildDashboardProposalCards({
      treasurySafes: [
        {
          id: 't-missing',
          parentId: 'p1',
          safeAddress: '0x4444',
          // @ts-expect-error exercise optional chain handling a missing chain
          chain: undefined,
          // @ts-expect-error exercise optional chain handling a missing label
          label: undefined,
          createdAtMs: 1,
        },
      ],
      governanceConfig: null,
    });
    expect(withMissingFields).toEqual([
      expect.objectContaining({
        tool: 'safe',
        ref: '0x4444',
        chain: undefined,
        treasuryEntryId: 't-missing',
        title: 'Safe multisig',
      }),
    ]);
  });

  it('skips treasury safes with empty address', () => {
    expect(
      buildDashboardProposalCards({
        treasurySafes: [
          {
            id: 't1',
            parentId: 'p1',
            safeAddress: '',
            chain: 'sepolia',
            label: 'Empty',
            createdAtMs: 1,
          },
          {
            id: 't2',
            parentId: 'p1',
            safeAddress: '   ',
            chain: 'sepolia',
            label: 'Whitespace',
            createdAtMs: 1,
          },
        ],
        governanceConfig: null,
      }),
    ).toEqual([]);
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

describe('dashboardProposalToolLabel', () => {
  it('labels each proposal tool', () => {
    expect(dashboardProposalToolLabel('pacto_gov')).toBe('Pacto Gov');
    expect(dashboardProposalToolLabel('safe')).toBe('Safe');
    expect(dashboardProposalToolLabel('nostr_poll')).toBe('Poll');
  });
});
