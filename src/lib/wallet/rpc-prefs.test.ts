import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  addPersonalRpc,
  loadDefaultRpc,
  loadRpcPrefs,
  listDefaultRpcOptions,
  listPersonalRpcs,
  resolveUserRpcUrls,
  saveDefaultRpc,
  WALLET_RPC_PREFS_PREFIX,
} from './rpc-prefs';

const NPUB = 'npub1test';

describe('rpc prefs', () => {
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

  it('stores personal RPCs per chain', () => {
    const url = 'https://arb-mainnet.g.alchemy.com/v2/demo-key';
    const result = addPersonalRpc(NPUB, 'arbitrum', url);
    expect(result.ok).toBe(true);
    expect(listPersonalRpcs(NPUB, 'arbitrum')).toEqual([url.replace(/\/+$/, '')]);
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

  it('persists under scoped storage key', () => {
    saveDefaultRpc(NPUB, 'optimism', 'https://mainnet.optimism.io');
    expect(store.has(`${WALLET_RPC_PREFS_PREFIX}_${NPUB}`)).toBe(true);
    expect(loadRpcPrefs(NPUB).defaultRpc.optimism).toBe('https://mainnet.optimism.io');
  });
});
