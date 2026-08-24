import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_SQUAD_PRACTICE_NETWORK,
  DEFAULT_SQUAD_PRIMARY_NETWORK,
  SQUAD_DEPLOYABLE_CHAIN_IDS,
  SQUAD_NETWORK_PREFIX,
  defaultSquadNetworkPair,
  isSquadDeployableChain,
  listSquadDeployNetworkOptions,
  loadSquadNetworkPair,
  loadSquadNetworkSlot,
  resolvePracticeSquadNetwork,
  resolvePrimarySquadNetwork,
  saveSquadNetworkPair,
  saveSquadNetworkSlot,
} from './squad-network';

describe('SQUAD_DEPLOYABLE_CHAIN_IDS', () => {
  it('restricts squad deploys to Sepolia + Local Anvil', () => {
    expect(SQUAD_DEPLOYABLE_CHAIN_IDS).toEqual(['sepolia', 'local']);
  });
});

describe('default pointers', () => {
  it('defaults both slots to Sepolia', () => {
    expect(DEFAULT_SQUAD_PRIMARY_NETWORK).toBe('sepolia');
    expect(DEFAULT_SQUAD_PRACTICE_NETWORK).toBe('sepolia');
    expect(defaultSquadNetworkPair()).toEqual({ primary: 'sepolia', practice: 'sepolia' });
  });
});

describe('isSquadDeployableChain', () => {
  it('accepts only deployable chains', () => {
    expect(isSquadDeployableChain('sepolia')).toBe(true);
    expect(isSquadDeployableChain('local')).toBe(true);
    expect(isSquadDeployableChain('mainnet')).toBe(false);
    expect(isSquadDeployableChain('arbitrum')).toBe(false);
    expect(isSquadDeployableChain('optimism')).toBe(false);
    expect(isSquadDeployableChain(null)).toBe(false);
    expect(isSquadDeployableChain(undefined)).toBe(false);
    expect(isSquadDeployableChain(42)).toBe(false);
  });
});

describe('listSquadDeployNetworkOptions', () => {
  it('lists the deployable chains with display labels', () => {
    const options = listSquadDeployNetworkOptions();
    expect(options.map((o) => o.id)).toEqual(['sepolia', 'local']);
    expect(options.find((o) => o.id === 'local')?.label).toBe('Local Anvil');
    for (const o of options) expect(o.label.length).toBeGreaterThan(0);
  });
});

describe('resolvePrimarySquadNetwork / resolvePracticeSquadNetwork', () => {
  it('prefers a valid override over the infra chain', () => {
    expect(resolvePrimarySquadNetwork({ override: 'local', infraChain: 'sepolia' })).toBe('local');
    expect(resolvePracticeSquadNetwork({ override: 'local', infraChain: 'sepolia' })).toBe('local');
  });

  it('falls back to the infra chain when there is no override', () => {
    expect(resolvePrimarySquadNetwork({ override: null, infraChain: 'sepolia' })).toBe('sepolia');
  });

  it('uses the slot default when nothing is set', () => {
    expect(resolvePrimarySquadNetwork({ override: null, infraChain: null })).toBe('sepolia');
    expect(resolvePracticeSquadNetwork({ override: null })).toBe('sepolia');
  });

  it('ignores non-deployable infra chains (reset to default)', () => {
    expect(resolvePrimarySquadNetwork({ override: null, infraChain: 'mainnet' })).toBe('sepolia');
    expect(resolvePrimarySquadNetwork({ override: null, infraChain: 'arbitrum' })).toBe('sepolia');
  });
});

describe('squad network pair persistence', () => {
  const npub = 'npub1squadnetworktestxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const parentId = 'parent-123';
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
  });

  it('round-trips a per-parent pair', () => {
    expect(loadSquadNetworkPair(npub, parentId)).toBeNull();
    saveSquadNetworkPair(npub, parentId, { primary: 'local', practice: 'sepolia' });
    expect(loadSquadNetworkPair(npub, parentId)).toEqual({ primary: 'local', practice: 'sepolia' });
    expect(loadSquadNetworkSlot(npub, parentId, 'primary')).toBe('local');
    expect(loadSquadNetworkSlot(npub, parentId, 'practice')).toBe('sepolia');
  });

  it('saves one slot without clobbering the other', () => {
    saveSquadNetworkPair(npub, parentId, { primary: 'sepolia', practice: 'sepolia' });
    saveSquadNetworkSlot(npub, parentId, 'practice', 'local');
    expect(loadSquadNetworkPair(npub, parentId)).toEqual({ primary: 'sepolia', practice: 'local' });
  });

  it('scopes pairs per parent', () => {
    saveSquadNetworkPair(npub, parentId, { primary: 'sepolia', practice: 'sepolia' });
    saveSquadNetworkPair(npub, 'parent-456', { primary: 'local', practice: 'local' });
    expect(loadSquadNetworkSlot(npub, parentId, 'primary')).toBe('sepolia');
    expect(loadSquadNetworkSlot(npub, 'parent-456', 'primary')).toBe('local');
  });

  it('does not persist non-deployable chains', () => {
    saveSquadNetworkPair(npub, parentId, { primary: 'mainnet' as never, practice: 'sepolia' });
    expect(loadSquadNetworkPair(npub, parentId)).toBeNull();
  });

  it('drops v1 single-chain blobs (reset to unset)', () => {
    store.set(
      `${SQUAD_NETWORK_PREFIX}_${npub}`,
      JSON.stringify({ v: 1, byParentId: { [parentId]: 'sepolia' } }),
    );
    expect(loadSquadNetworkPair(npub, parentId)).toBeNull();
  });

  it('drops stale/unknown persisted values on load', () => {
    store.set(
      `${SQUAD_NETWORK_PREFIX}_${npub}`,
      JSON.stringify({ v: 2, byParentId: { [parentId]: { primary: 'optimism', practice: 'local' } } }),
    );
    expect(loadSquadNetworkPair(npub, parentId)).toEqual({ primary: 'sepolia', practice: 'local' });
  });

  it('returns null without an npub or parentId', () => {
    saveSquadNetworkPair(npub, parentId, { primary: 'local', practice: 'sepolia' });
    expect(loadSquadNetworkPair(null, parentId)).toBeNull();
    expect(loadSquadNetworkPair(npub, '')).toBeNull();
  });
});
