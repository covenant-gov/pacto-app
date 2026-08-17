import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSquadInvokeRpcUrls,
  clearSquadRpcBackup,
  clearSquadRpcPrimary,
  effectiveSquadRpcConfig,
  initSquadRpcOnCreate,
  resolveSquadRpcUrls,
  setSquadRpcBackup,
  setSquadRpcPrimary,
  classifySquadChainRpcUrl,
  isPimlicoBundlerHost,
  SQUAD_RPC_PREFIX,
} from './squad-rpc';
import { WALLET_RPC_PREFS_PREFIX } from '../wallet/rpc-prefs';

const npub = 'npub1testrpc';
const parentId = 'parent-rpc-1';

beforeEach(() => {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem(key: string) {
      return store[key] ?? null;
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
    removeItem(key: string) {
      delete store[key];
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('squad-rpc slot transitions', () => {
  it('initSquadRpcOnCreate sets public primary and unset backup', () => {
    const cfg = initSquadRpcOnCreate(npub, parentId, 'sepolia');
    expect(cfg.rpc1).toEqual({ kind: 'default_public' });
    expect(cfg.rpc2).toEqual({ kind: 'unset' });
    expect(loadRaw()).toBeTruthy();
  });

  it('rejects Pimlico bundler hosts as chain RPC', () => {
    expect(isPimlicoBundlerHost('https://api.pimlico.io/v2/11155111/rpc?apikey=x')).toBe(true);
    expect(isPimlicoBundlerHost('https://eth-sepolia.g.alchemy.com/v2/abc')).toBe(false);
    expect(classifySquadChainRpcUrl('https://api.pimlico.io/v2/11155111/rpc')).toEqual({
      ok: false,
      error: 'squad.rpc.error.bundlerUrl',
    });
    initSquadRpcOnCreate(npub, parentId, 'sepolia');
    const res = setSquadRpcPrimary(
      npub,
      parentId,
      'sepolia',
      'https://api.pimlico.io/v2/11155111/rpc?apikey=x',
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('squad.rpc.error.bundlerUrl');
  });

  it('setSquadRpcPrimary sets custom + public backup', () => {
    initSquadRpcOnCreate(npub, parentId, 'sepolia');
    const res = setSquadRpcPrimary(npub, parentId, 'sepolia', 'https://eth-sepolia.g.alchemy.com/v2/abc');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.rpc1).toEqual({
      kind: 'url',
      url: 'https://eth-sepolia.g.alchemy.com/v2/abc',
    });
    expect(res.config.rpc2).toEqual({ kind: 'default_public' });
  });

  it('setSquadRpcBackup requires custom primary and clears public from slots', () => {
    initSquadRpcOnCreate(npub, parentId, 'sepolia');
    expect(setSquadRpcBackup(npub, parentId, 'sepolia', 'https://backup.example/rpc').ok).toBe(false);
    setSquadRpcPrimary(npub, parentId, 'sepolia', 'https://primary.example/rpc');
    const res = setSquadRpcBackup(npub, parentId, 'sepolia', 'https://backup.example/rpc');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.rpc1.kind).toBe('url');
    expect(res.config.rpc2).toEqual({ kind: 'url', url: 'https://backup.example/rpc' });
    const urls = resolveSquadRpcUrls(res.config);
    expect(urls).toEqual(['https://primary.example/rpc', 'https://backup.example/rpc']);
  });

  it('clear primary resets to factory; clear backup restores public when primary custom', () => {
    setSquadRpcPrimary(npub, parentId, 'sepolia', 'https://primary.example/rpc');
    setSquadRpcBackup(npub, parentId, 'sepolia', 'https://backup.example/rpc');
    const clearedBackup = clearSquadRpcBackup(npub, parentId, 'sepolia');
    expect(clearedBackup.rpc1.kind).toBe('url');
    expect(clearedBackup.rpc2).toEqual({ kind: 'default_public' });
    const cleared = clearSquadRpcPrimary(npub, parentId, 'sepolia');
    expect(cleared.rpc1).toEqual({ kind: 'default_public' });
    expect(cleared.rpc2).toEqual({ kind: 'unset' });
  });
});

describe('buildSquadInvokeRpcUrls tertiary user default', () => {
  it('appends distinct Settings default after squad public', () => {
    initSquadRpcOnCreate(npub, parentId, 'sepolia');
    localStorage.setItem(
      `${WALLET_RPC_PREFS_PREFIX}_${npub}`,
      JSON.stringify({
        v: 1,
        personal: { sepolia: ['https://my.alchemy.example/v2/key'] },
        defaultRpc: { sepolia: 'https://my.alchemy.example/v2/key' },
      }),
    );
    const urls = buildSquadInvokeRpcUrls(npub, parentId, 'sepolia');
    // Squad default_public expands to operator Alchemy (if set) and/or curated publics.
    expect(urls.length).toBeGreaterThan(1);
    expect(urls[urls.length - 1]).toBe('https://my.alchemy.example/v2/key');
    expect(urls.slice(0, -1)).not.toContain('https://my.alchemy.example/v2/key');
  });

  it('does not append user default when it duplicates squad custom primary', () => {
    const url = 'https://shared.example/rpc';
    setSquadRpcPrimary(npub, parentId, 'sepolia', url);
    localStorage.setItem(
      `${WALLET_RPC_PREFS_PREFIX}_${npub}`,
      JSON.stringify({
        v: 1,
        personal: { sepolia: [url] },
        defaultRpc: { sepolia: url },
      }),
    );
    const urls = buildSquadInvokeRpcUrls(npub, parentId, 'sepolia');
    expect(urls.filter((u) => u === url)).toHaveLength(1);
  });

  it('effectiveSquadRpcConfig returns defaults when unset', () => {
    const cfg = effectiveSquadRpcConfig(npub, parentId, 'sepolia');
    expect(cfg?.rpc1.kind).toBe('default_public');
    expect(cfg?.rpc2.kind).toBe('unset');
  });

  it('effectiveSquadRpcConfig resets slots when stored chain mismatches', () => {
    setSquadRpcPrimary(npub, parentId, 'sepolia', 'https://sepolia.example/rpc');
    const cfg = effectiveSquadRpcConfig(npub, parentId, 'local');
    expect(cfg).toEqual({
      chain: 'local',
      rpc1: { kind: 'default_public' },
      rpc2: { kind: 'unset' },
    });
  });
});

function loadRaw(): string | null {
  return localStorage.getItem(`${SQUAD_RPC_PREFIX}_${npub}`);
}
