import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SQUAD_DEPLOYABLE_CHAIN_IDS,
  SQUAD_NETWORK_PREFIX,
  isSquadDeployableChain,
  listSquadDeployNetworkOptions,
  loadSquadNetworkOverride,
  resolveSquadNetwork,
  saveSquadNetworkOverride,
} from './squad-network';

describe('SQUAD_DEPLOYABLE_CHAIN_IDS', () => {
  it('restricts squad deploys to Sepolia + Local Anvil', () => {
    expect(SQUAD_DEPLOYABLE_CHAIN_IDS).toEqual(['sepolia', 'local']);
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

describe('resolveSquadNetwork', () => {
  it('prefers a valid override over the infra chain', () => {
    expect(resolveSquadNetwork({ override: 'local', infraChain: 'sepolia' })).toBe('local');
  });

  it('falls back to the infra chain when there is no override', () => {
    expect(resolveSquadNetwork({ override: null, infraChain: 'sepolia' })).toBe('sepolia');
  });

  it('is null (unestablished) when nothing is set', () => {
    expect(resolveSquadNetwork({ override: null, infraChain: null })).toBeNull();
  });

  it('ignores non-deployable infra chains (reset to unset)', () => {
    expect(resolveSquadNetwork({ override: null, infraChain: 'mainnet' })).toBeNull();
    expect(resolveSquadNetwork({ override: null, infraChain: 'arbitrum' })).toBeNull();
  });
});

describe('squad network override persistence', () => {
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

  it('round-trips a per-parent override', () => {
    expect(loadSquadNetworkOverride(npub, parentId)).toBeNull();
    saveSquadNetworkOverride(npub, parentId, 'local');
    expect(loadSquadNetworkOverride(npub, parentId)).toBe('local');
  });

  it('scopes overrides per parent', () => {
    saveSquadNetworkOverride(npub, parentId, 'sepolia');
    saveSquadNetworkOverride(npub, 'parent-456', 'local');
    expect(loadSquadNetworkOverride(npub, parentId)).toBe('sepolia');
    expect(loadSquadNetworkOverride(npub, 'parent-456')).toBe('local');
  });

  it('does not persist non-deployable chains', () => {
    saveSquadNetworkOverride(npub, parentId, 'mainnet' as never);
    expect(loadSquadNetworkOverride(npub, parentId)).toBeNull();
  });

  it('drops stale/unknown persisted values on load', () => {
    store.set(
      `${SQUAD_NETWORK_PREFIX}_${npub}`,
      JSON.stringify({ v: 1, byParentId: { [parentId]: 'optimism' } }),
    );
    expect(loadSquadNetworkOverride(npub, parentId)).toBeNull();
  });

  it('returns null without an npub or parentId', () => {
    saveSquadNetworkOverride(npub, parentId, 'local');
    expect(loadSquadNetworkOverride(null, parentId)).toBeNull();
    expect(loadSquadNetworkOverride(npub, '')).toBeNull();
  });
});
