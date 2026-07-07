import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  SETTINGS_CHAIN_CACHE_PREFIX,
  getCachedSettingsChainSnapshot,
  hydrateSettingsChainCacheFromDisk,
  persistSettingsChainSnapshot,
  settingsChainCacheKey,
  clearSettingsChainCacheStore,
  removeSettingsChainCacheForParent,
  settingsChainHydrated,
} from './settings-chain-cache';

describe('settings-chain-cache', () => {
  const npub = 'npub1testsettingschainxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const parentId = 'parent-1';

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
    clearSettingsChainCacheStore();
  });

  it('round-trips member hat/role maps when fingerprint matches', () => {
    const evm = { npub1: '0xabc', npub2: '0xdef' };
    const cacheKey = settingsChainCacheKey({
      network: 'sepolia',
      topHatId: '0x1',
      squadAdminProxy: '0x2',
      squadMemberEvmByNpub: evm,
    });
    persistSettingsChainSnapshot(npub, parentId, cacheKey, {
      memberHatByAddress: { '0xabc': 'Captain' },
      memberRolesByAddress: { '0xabc': 'Executor' },
    });
    hydrateSettingsChainCacheFromDisk(npub);
    const snap = getCachedSettingsChainSnapshot(npub, parentId, cacheKey);
    expect(snap?.memberHatByAddress['0xabc']).toBe('Captain');
    expect(snap?.memberRolesByAddress['0xabc']).toBe('Executor');
    expect(localStorage.getItem(`${SETTINGS_CHAIN_CACHE_PREFIX}_${npub}`)).toBeTruthy();
  });

  it('returns null when the cache key does not match', () => {
    const evm = { npub1: '0xabc', npub2: '0xdef' };
    const cacheKey = settingsChainCacheKey({
      network: 'sepolia',
      topHatId: '0x1',
      squadAdminProxy: '0x2',
      squadMemberEvmByNpub: evm,
    });
    persistSettingsChainSnapshot(npub, parentId, cacheKey, {
      memberHatByAddress: { '0xabc': 'Captain' },
      memberRolesByAddress: { '0xabc': 'Executor' },
    });
    expect(getCachedSettingsChainSnapshot(npub, parentId, 'different-key')).toBeNull();
  });

  it('clearSettingsChainCacheStore resets the hydrated store', () => {
    const evm = { npub1: '0xabc' };
    const cacheKey = settingsChainCacheKey({
      network: 'sepolia',
      topHatId: '0x1',
      squadAdminProxy: '0x2',
      squadMemberEvmByNpub: evm,
    });
    persistSettingsChainSnapshot(npub, parentId, cacheKey, {
      memberHatByAddress: {},
      memberRolesByAddress: {},
    });
    expect(get(settingsChainHydrated)).not.toBeNull();
    clearSettingsChainCacheStore();
    expect(get(settingsChainHydrated)).toBeNull();
  });

  it('removeSettingsChainCacheForParent deletes the disk and store entry', () => {
    const evm = { npub1: '0xabc' };
    const cacheKey = settingsChainCacheKey({
      network: 'sepolia',
      topHatId: '0x1',
      squadAdminProxy: '0x2',
      squadMemberEvmByNpub: evm,
    });
    persistSettingsChainSnapshot(npub, parentId, cacheKey, {
      memberHatByAddress: { '0xabc': 'Captain' },
      memberRolesByAddress: { '0xabc': 'Executor' },
    });
    expect(getCachedSettingsChainSnapshot(npub, parentId, cacheKey)).not.toBeNull();

    removeSettingsChainCacheForParent(npub, parentId);

    expect(getCachedSettingsChainSnapshot(npub, parentId, cacheKey)).toBeNull();
    expect(get(settingsChainHydrated)?.byParentId[parentId]).toBeUndefined();
  });
});
