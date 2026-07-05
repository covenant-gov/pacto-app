import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  GOVERNANCE_SNAPSHOT_CACHE_PREFIX,
  clearGovernanceSnapshotCacheStore,
  getCachedHatsTree,
  getCachedTreasuryProposals,
  governanceSnapshotHydrated,
  hydrateGovernanceSnapshotCacheFromDisk,
  persistHatsTreeSnapshot,
  persistTreasuryProposalsSnapshot,
} from './governance-snapshot-cache';
import type { HatTreeNodeDto, TreasuryProposalDto } from '../governance/api';

describe('governance-snapshot-cache', () => {
  const npub = 'npub1testgovernancesnapshot';
  const key = 'test-key';

  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    governanceSnapshotHydrated.set(null);
  });

  function proposal(id: string): TreasuryProposalDto {
    return {
      proposalId: id,
      proposer: '0xabc',
      to: '0xdef',
      valueWei: '0',
      operation: '0',
      dataHex: '0x',
      deadline: 1,
      snapshot: 1,
      yeas: 0,
      nays: 0,
      captainApproved: false,
      captainDefeated: false,
      executed: false,
      status: 'active',
    };
  }

  function hatTree(): HatTreeNodeDto {
    return {
      hatId: '0x1',
      details: 'Top',
      maxSupply: 1,
      supply: 1,
      active: true,
      children: [],
    };
  }

  it('hydrates treasury proposals into the store', () => {
    const proposals = [proposal('p1')];
    persistTreasuryProposalsSnapshot(npub, key, proposals);
    governanceSnapshotHydrated.set(null);

    hydrateGovernanceSnapshotCacheFromDisk(npub);

    const h = get(governanceSnapshotHydrated);
    expect(h?.npub).toBe(npub);
    expect(h?.treasuryProposalsByKey[key]?.proposals).toEqual(proposals);
    expect(getCachedTreasuryProposals(npub, key)?.proposals).toEqual(proposals);
  });

  it('hydrates hats tree into the store', () => {
    const tree = hatTree();
    persistHatsTreeSnapshot(npub, key, tree);
    governanceSnapshotHydrated.set(null);

    hydrateGovernanceSnapshotCacheFromDisk(npub);

    const h = get(governanceSnapshotHydrated);
    expect(h?.hatsTreeByKey[key]?.tree).toEqual(tree);
    expect(getCachedHatsTree(npub, key)?.tree).toEqual(tree);
  });

  it('persists a null hats tree and treats it as a valid snapshot', () => {
    persistHatsTreeSnapshot(npub, key, null);
    expect(getCachedHatsTree(npub, key)?.tree).toBeNull();
  });

  it('clearGovernanceSnapshotCacheStore resets the hydrated store', () => {
    persistTreasuryProposalsSnapshot(npub, key, [proposal('p1')]);
    expect(get(governanceSnapshotHydrated)).not.toBeNull();
    clearGovernanceSnapshotCacheStore();
    expect(get(governanceSnapshotHydrated)).toBeNull();
  });

  it('returns null for a mismatched treasury proposal key', () => {
    persistTreasuryProposalsSnapshot(npub, key, [proposal('p1')]);
    expect(getCachedTreasuryProposals(npub, 'wrong-key')).toBeNull();
  });

  it('returns null for a mismatched hats tree key', () => {
    persistHatsTreeSnapshot(npub, key, hatTree());
    expect(getCachedHatsTree(npub, 'wrong-key')).toBeNull();
  });

  it('validates treasury proposals and rejects malformed snapshots', () => {
    const good = proposal('p1');
    store.set(
      `${GOVERNANCE_SNAPSHOT_CACHE_PREFIX}_${npub}`,
      JSON.stringify({
        version: 1,
        treasuryProposalsByKey: {
          [key]: {
            proposals: [good, { ...good, status: 123 }],
            fetchedAtMs: 1,
          },
        },
        hatsTreeByKey: {},
      }),
    );

    expect(getCachedTreasuryProposals(npub, key)).toBeNull();
  });

  it('validates hats tree snapshots and rejects malformed entries', () => {
    store.set(
      `${GOVERNANCE_SNAPSHOT_CACHE_PREFIX}_${npub}`,
      JSON.stringify({
        version: 1,
        treasuryProposalsByKey: {},
        hatsTreeByKey: {
          [key]: {
            tree: { hatId: 'ok', children: 'not-an-array' },
            fetchedAtMs: 1,
          },
        },
      }),
    );

    expect(getCachedHatsTree(npub, key)).toBeNull();
  });
});
