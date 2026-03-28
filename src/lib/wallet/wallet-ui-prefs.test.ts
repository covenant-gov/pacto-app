import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadWalletEnabledChains,
  saveWalletEnabledChains,
  defaultWalletEnabledChains,
  WALLET_UI_ENABLED_CHAINS_PREFIX,
} from './wallet-ui-prefs';
import type { SupportedChainId } from './chains';

describe('wallet-ui-prefs', () => {
  const npub = 'npub1testwalletprefsxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

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

  it('defaults to all configured chains', () => {
    const d = defaultWalletEnabledChains();
    expect(d.length).toBeGreaterThanOrEqual(3);
    expect(d).toContain('sepolia');
  });

  it('round-trips enabled subset', () => {
    const subset: SupportedChainId[] = ['sepolia', 'mainnet'];
    saveWalletEnabledChains(npub, subset);
    expect(loadWalletEnabledChains(npub)).toEqual(subset);
  });

  it('drops unknown chain ids', () => {
    localStorage.setItem(
      `${WALLET_UI_ENABLED_CHAINS_PREFIX}_${npub}`,
      JSON.stringify({ v: 1, chains: ['sepolia', 'fakechain'] })
    );
    expect(loadWalletEnabledChains(npub)).toEqual(['sepolia']);
  });

  it('falls back to defaults when empty array stored', () => {
    localStorage.setItem(
      `${WALLET_UI_ENABLED_CHAINS_PREFIX}_${npub}`,
      JSON.stringify({ v: 1, chains: [] })
    );
    expect(loadWalletEnabledChains(npub)).toEqual(defaultWalletEnabledChains());
  });
});
