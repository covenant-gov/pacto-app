import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { runDevAutologin } from './autologin';
import { isAuthenticated, currentUser } from '../../stores/auth';
import { loadAccountState } from '../../stores/persistence';
import { runPostLoginNetworkSync } from '../app/post-login-sync';
import { freezeGate } from '../updater/update-gate';
import { walletSidebarOpen } from '../../stores/dm';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../stores/persistence', () => ({
  loadAccountState: vi.fn(),
}));

vi.mock('../app/post-login-sync', () => ({
  runPostLoginNetworkSync: vi.fn(),
}));

vi.mock('../updater/update-gate', () => ({
  freezeGate: vi.fn(),
  awaitGateBeforeAuth: vi.fn().mockResolvedValue('clear'),
}));

// `local-dev-setup.ts` lives in this same directory; mocking it here
// intercepts `stores/auth.ts`'s dynamic import of that same resolved file.
vi.mock('./local-dev-setup', () => ({
  applyLocalDevDefaults: vi.fn().mockResolvedValue(undefined),
}));

function setDev(value: boolean) {
  (import.meta.env as { DEV?: boolean }).DEV = value;
}

describe('runDevAutologin', () => {
  const originalDev = import.meta.env.DEV;

  beforeEach(() => {
    vi.clearAllMocks();
    isAuthenticated.set(false);
    currentUser.set(null);
    setDev(true);
  });

  afterEach(() => {
    setDev(originalDev);
  });

  it('does nothing outside a dev build', async () => {
    setDev(false);

    await runDevAutologin();

    expect(invoke).not.toHaveBeenCalled();
    expect(get(isAuthenticated)).toBe(false);
  });

  it('is a no-op and touches no store when the backend reports skipped', async () => {
    vi.mocked(invoke).mockResolvedValue({ skipped: true, reason: 'no mnemonic configured' });

    await runDevAutologin();

    expect(get(isAuthenticated)).toBe(false);
    expect(get(currentUser)).toBeNull();
    expect(loadAccountState).not.toHaveBeenCalled();
    expect(freezeGate).not.toHaveBeenCalled();
    expect(runPostLoginNetworkSync).not.toHaveBeenCalled();
  });

  it('hydrates the session on a successful backend login', async () => {
    walletSidebarOpen.set(true);
    const pubkeyHex = 'bb'.repeat(32);
    vi.mocked(invoke).mockResolvedValue({
      success: true,
      npub: 'npub1devsandbox',
      pubkey_hex: pubkeyHex,
    });

    await runDevAutologin();

    expect(get(isAuthenticated)).toBe(true);
    expect(get(currentUser)).toEqual({ npub: 'npub1devsandbox', pubkey: pubkeyHex });
    expect(loadAccountState).toHaveBeenCalledWith('npub1devsandbox');
    expect(get(walletSidebarOpen)).toBe(false);
    expect(freezeGate).toHaveBeenCalledTimes(1);
    expect(runPostLoginNetworkSync).toHaveBeenCalledWith('npub1devsandbox');
  });

  it('leaves auth state untouched when the backend invoke rejects', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('Test auth disabled'));

    await runDevAutologin();

    expect(get(isAuthenticated)).toBe(false);
    expect(get(currentUser)).toBeNull();
    expect(loadAccountState).not.toHaveBeenCalled();
    expect(freezeGate).not.toHaveBeenCalled();
    expect(runPostLoginNetworkSync).not.toHaveBeenCalled();
  });
});
