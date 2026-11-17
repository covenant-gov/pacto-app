import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadWalletEnabledChains,
  saveWalletEnabledChains,
  defaultWalletEnabledChains,
  migrateEnabledChainsV1,
  WALLET_UI_ENABLED_CHAINS_PREFIX,
} from './wallet-ui-prefs';
import type { SupportedChainId } from './chains';

function setDev(value: boolean) {
  (import.meta.env as { DEV?: boolean }).DEV = value;
}

describe('wallet-ui-prefs', () => {
  const npub = 'npub1testwalletprefsxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

  const store = new Map<string, string>();
  let originalDev: boolean | undefined;

  beforeEach(() => {
    originalDev = (import.meta.env as { DEV?: boolean }).DEV;
    store.clear();
    setDev(false);
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
    if (originalDev === undefined) {
      delete (import.meta.env as { DEV?: boolean }).DEV;
    } else {
      setDev(originalDev);
    }
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });
  it('defaults to Sepolia and Arbitrum in every build', () => {
    expect(defaultWalletEnabledChains()).toEqual(['sepolia', 'arbitrum']);
    setDev(true);
    expect(defaultWalletEnabledChains()).toEqual(['sepolia', 'arbitrum']);
  });

  it('replaces the old automatic defaults and strips Anvil', () => {
    expect(migrateEnabledChainsV1(['sepolia', 'local'])).toEqual(['sepolia', 'arbitrum']);
    expect(migrateEnabledChainsV1(['arbitrum'])).toEqual(['sepolia', 'arbitrum']);
    expect(migrateEnabledChainsV1(['mainnet', 'local'])).toEqual(['mainnet']);
    expect(migrateEnabledChainsV1(['local'])).toEqual(['sepolia', 'arbitrum']);
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

  it('migrates a version-1 dev default to Sepolia and Arbitrum', () => {
    localStorage.setItem(
      `${WALLET_UI_ENABLED_CHAINS_PREFIX}_${npub}`,
      JSON.stringify({ v: 1, chains: ['sepolia', 'local'] })
    );
    expect(loadWalletEnabledChains(npub)).toEqual(['sepolia', 'arbitrum']);
    expect(JSON.parse(localStorage.getItem(`${WALLET_UI_ENABLED_CHAINS_PREFIX}_${npub}`) ?? '').v).toBe(2);
  });

  it('keeps Anvil when it was saved on the current version', () => {
    saveWalletEnabledChains(npub, ['sepolia', 'local']);
    expect(loadWalletEnabledChains(npub)).toEqual(['sepolia', 'local']);
  });

  it('falls back to defaults when empty array stored', () => {
    localStorage.setItem(
      `${WALLET_UI_ENABLED_CHAINS_PREFIX}_${npub}`,
      JSON.stringify({ v: 1, chains: [] })
    );
    expect(loadWalletEnabledChains(npub)).toEqual(defaultWalletEnabledChains());
  });
});
