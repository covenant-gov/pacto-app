import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_PREFERRED_NETWORK,
  getPreferredNetworkDisplayName,
  isPreferredNetworkId,
  listPreferredNetworkOptions,
  loadPreferredNetwork,
  savePreferredNetwork,
  WALLET_PREFERRED_NETWORK_PREFIX,
} from './preferred-network';

const NPUB = 'npub1test';

describe('preferred network prefs', () => {
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

  it('defaults to Arbitrum when unset', () => {
    expect(loadPreferredNetwork(NPUB)).toBe(DEFAULT_PREFERRED_NETWORK);
    expect(DEFAULT_PREFERRED_NETWORK).toBe('arbitrum');
  });

  it('persists a supported catalog network', () => {
    savePreferredNetwork(NPUB, 'sepolia');
    expect(loadPreferredNetwork(NPUB)).toBe('sepolia');
    const raw = store.get(`${WALLET_PREFERRED_NETWORK_PREFIX}_${NPUB}`);
    expect(raw).toContain('sepolia');
  });

  it('rejects unknown stored values', () => {
    store.set(
      `${WALLET_PREFERRED_NETWORK_PREFIX}_${NPUB}`,
      JSON.stringify({ v: 1, network: 'polygon' }),
    );
    expect(loadPreferredNetwork(NPUB)).toBe('arbitrum');
  });

  it('labels Arbitrum for display', () => {
    expect(getPreferredNetworkDisplayName('arbitrum')).toBe('Arbitrum');
    expect(isPreferredNetworkId('arbitrum')).toBe(true);
    expect(isPreferredNetworkId('polygon')).toBe(false);
  });
});

describe('default wallet config (preferred network)', () => {
  it('lists Arbitrum first for the edit dropdown', () => {
    const options = listPreferredNetworkOptions();
    expect(options[0]?.id).toBe('arbitrum');
    expect(options[0]?.label).toBe('Arbitrum');
    expect(options.some((o) => o.id === 'sepolia')).toBe(true);
  });
});
