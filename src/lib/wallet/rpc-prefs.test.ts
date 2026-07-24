import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  addPersonalRpc,
  formatRpcDisplay,
  isValidRpcUrl,
  loadDefaultRpc,
  loadRpcPrefs,
  listDefaultRpcOptions,
  listPersonalRpcs,
  normalizeRpcUrl,
  removePersonalRpc,
  resolveUserRpcUrls,
  saveDefaultRpc,
  WALLET_RPC_PREFS_PREFIX,
} from './rpc-prefs';

const NPUB = 'npub1test';

function setDev(value: boolean) {
  (import.meta.env as { DEV?: boolean }).DEV = value;
}

describe('rpc prefs', () => {
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
    // Seed valid empty prefs so load never returns the shared EMPTY_PREFS shallow copy.
    store.set(
      `${WALLET_RPC_PREFS_PREFIX}_${NPUB}`,
      JSON.stringify({ v: 1, personal: {}, defaultRpc: {} }),
    );
  });

  afterEach(() => {
    if (originalDev === undefined) {
      delete (import.meta.env as { DEV?: boolean }).DEV;
    } else {
      setDev(originalDev);
    }
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('validates and normalizes RPC URLs', () => {
    expect(isValidRpcUrl('https://example.com/rpc')).toBe(true);
    expect(isValidRpcUrl('http://localhost:8545')).toBe(true);
    expect(isValidRpcUrl('http://127.0.0.1:8545')).toBe(true);
    expect(isValidRpcUrl('http://example.com/rpc')).toBe(false);
    expect(isValidRpcUrl('ftp://example.com')).toBe(false);
    expect(isValidRpcUrl('not a url')).toBe(false);
    expect(normalizeRpcUrl(' https://example.com/rpc/ ')).toBe('https://example.com/rpc');
    expect(normalizeRpcUrl('ftp://example.com')).toBeNull();
    expect(normalizeRpcUrl('http://example.com/rpc')).toBeNull();
    expect(formatRpcDisplay('https://short.example/rpc')).toBe('https://short.example/rpc');
    expect(
      formatRpcDisplay('https://very-long-rpc-provider.example.com/v2/with-a-long-path-and-key'),
    ).toContain('…');
  });

  it('stores personal RPCs per chain', () => {
    const url = 'https://arb-mainnet.g.alchemy.com/v2/demo-key';
    const result = addPersonalRpc(NPUB, 'arbitrum', url);
    expect(result.ok).toBe(true);
    expect(listPersonalRpcs(NPUB, 'arbitrum')).toEqual([url.replace(/\/+$/, '')]);
  });

  it('rejects invalid and duplicate personal RPCs', () => {
    expect(addPersonalRpc(NPUB, 'sepolia', 'ftp://x').ok).toBe(false);
    const url = 'https://example.com/rpc';
    expect(addPersonalRpc(NPUB, 'sepolia', url).ok).toBe(true);
    expect(addPersonalRpc(NPUB, 'sepolia', url).ok).toBe(false);
  });

  it('lists personal and curated options for default picker', () => {
    const url = 'https://example.com/rpc';
    addPersonalRpc(NPUB, 'sepolia', url);
    const options = listDefaultRpcOptions(NPUB, 'sepolia');
    expect(options.some((o) => o.value === url && o.group === 'personal')).toBe(true);
    expect(options.some((o) => o.group === 'curated')).toBe(true);
  });

  it('uses selected default RPC as primary in resolution', () => {
    const url = 'https://example.com/rpc';
    addPersonalRpc(NPUB, 'arbitrum', url);
    saveDefaultRpc(NPUB, 'arbitrum', url);
    expect(loadDefaultRpc(NPUB, 'arbitrum')).toBe(url);
    expect(resolveUserRpcUrls('arbitrum', NPUB)[0]).toBe(url);
  });

  it('clears defaults and removes personal RPCs', () => {
    const url = 'https://example.com/rpc';
    addPersonalRpc(NPUB, 'arbitrum', url);
    saveDefaultRpc(NPUB, 'arbitrum', url);
    saveDefaultRpc(NPUB, 'arbitrum', null);
    expect(loadDefaultRpc(NPUB, 'arbitrum')).toBeNull();
    saveDefaultRpc(NPUB, 'arbitrum', url);
    removePersonalRpc(NPUB, 'arbitrum', url);
    expect(listPersonalRpcs(NPUB, 'arbitrum')).toEqual([]);
    expect(loadDefaultRpc(NPUB, 'arbitrum')).toBeNull();
  });

  it('ignores corrupt storage and disallowed defaults', () => {
    expect(loadRpcPrefs(undefined).personal).toEqual({});
    store.set(`${WALLET_RPC_PREFS_PREFIX}_${NPUB}`, '{');
    expect(loadRpcPrefs(NPUB).defaultRpc).toEqual({});
    store.set(
      `${WALLET_RPC_PREFS_PREFIX}_${NPUB}`,
      JSON.stringify({
        v: 999,
        personal: { sepolia: ['https://example.com'] },
      }),
    );
    expect(Object.keys(loadRpcPrefs(NPUB).personal)).toEqual([]);
    store.set(
      `${WALLET_RPC_PREFS_PREFIX}_${NPUB}`,
      JSON.stringify({
        v: 1,
        personal: { nope: ['https://example.com'], sepolia: ['ftp://x', 'https://ok.example', 3] },
        defaultRpc: { sepolia: 'https://not-allowed.example', arbitrum: 12 },
      }),
    );
    expect(listPersonalRpcs(NPUB, 'sepolia')).toEqual(['https://ok.example']);
    expect(loadDefaultRpc(NPUB, 'sepolia')).toBeNull();
    saveDefaultRpc(NPUB, 'sepolia', 'https://not-allowed.example');
    expect(loadDefaultRpc(NPUB, 'sepolia')).toBeNull();
    expect(resolveUserRpcUrls('sepolia', NPUB)[0]).not.toBe('https://not-allowed.example');
    expect(resolveUserRpcUrls('sepolia', null).length).toBeGreaterThan(0);
  });

  it('persists under scoped storage key', () => {
    saveDefaultRpc(NPUB, 'mainnet', 'https://ethereum.publicnode.com');
    expect(store.has(`${WALLET_RPC_PREFS_PREFIX}_${NPUB}`)).toBe(true);
    expect(loadRpcPrefs(NPUB).defaultRpc.mainnet).toBe('https://ethereum.publicnode.com');
  });

  it('allows local personal RPCs like any other chain (both builds)', () => {
    const url = 'http://localhost:8545';
    expect(addPersonalRpc(NPUB, 'local', url).ok).toBe(true);
    expect(listPersonalRpcs(NPUB, 'local')).toEqual([url]);
  });

  it('allows local default RPCs like any other chain (both builds)', () => {
    const url = 'http://localhost:8545';
    addPersonalRpc(NPUB, 'local', url);
    saveDefaultRpc(NPUB, 'local', url);
    expect(loadDefaultRpc(NPUB, 'local')).toBe(url);
  });

  it('resolves local URLs like any other chain (both builds)', () => {
    const url = 'http://localhost:8545';
    addPersonalRpc(NPUB, 'local', url);
    saveDefaultRpc(NPUB, 'local', url);
    expect(resolveUserRpcUrls('local', NPUB)).toEqual([url]);
  });
});
