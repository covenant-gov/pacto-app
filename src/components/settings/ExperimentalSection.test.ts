// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { invoke } from '@tauri-apps/api/core';
import { currentUser } from '../../stores/auth-session';
import { appConfig, DEFAULT_APP_CONFIG } from '../../stores/app-config';
import { featureFlagOverrides } from '../../stores/feature-flags';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import type { EvmAccountRow } from '../../lib/wallet/evm-accounts';
import ExperimentalSection from './ExperimentalSection.svelte';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

const importedKey: EvmAccountRow = {
  id: 'imported-key',
  scheme: 'imported_private_key',
  hdIndex: null,
  address: '0x1111111111111111111111111111111111111111',
  label: 'Outside key',
  purpose: 'advanced',
  isActive: false,
  isDefaultShared: false,
  isActiveAdvanced: true,
};

const squadKey: EvmAccountRow = {
  id: 'squad-key',
  scheme: 'bip44_v1',
  hdIndex: 0,
  address: '0x2222222222222222222222222222222222222222',
  label: 'Squad treasury',
  purpose: 'squad',
  isActive: true,
  isDefaultShared: true,
  isActiveAdvanced: false,
};

beforeEach(() => {
  window.__TAURI__ = {};
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  setCurrentNpubForPersistence('npub1experimental');
  currentUser.set({ npub: 'npub1experimental', pubkey: 'experimental' });
  featureFlagOverrides.set({});
  appConfig.set({
    ...DEFAULT_APP_CONFIG,
    featureFlags: [{ key: 'advanced_evm_accounts', defaultEnabled: false }],
  });
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_evm_accounts') return [importedKey, squadKey];
    return null;
  });
});

afterEach(() => {
  cleanup();
  delete window.__TAURI__;
  currentUser.set(null);
  setCurrentNpubForPersistence(null);
  featureFlagOverrides.set({});
  appConfig.set(DEFAULT_APP_CONFIG);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ExperimentalSection', () => {
  it('lists an existing imported key and hides import until the switch is on', async () => {
    render(ExperimentalSection);

    expect(await screen.findByText('Outside key')).toBeTruthy();
    expect(screen.queryByText('Squad treasury')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import private key' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Advanced contract call' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add advanced account' })).toBeNull();

    await fireEvent.click(screen.getByRole('checkbox', { name: /Imported key/ }));

    expect(screen.getByRole('button', { name: 'Import private key' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Advanced contract call' })).toBeNull();
  });
});
