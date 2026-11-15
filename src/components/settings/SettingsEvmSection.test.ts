// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { currentUser } from '../../stores/auth-session';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import SettingsEvmSection from './SettingsEvmSection.svelte';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

beforeEach(() => {
  window.__TAURI__ = {};
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  setCurrentNpubForPersistence(null);
  currentUser.set({ npub: 'npub1walletviewtest', pubkey: 'walletviewtest' });
});

afterEach(() => {
  cleanup();
  delete window.__TAURI__;
  currentUser.set(null);
  setCurrentNpubForPersistence(null);
  vi.unstubAllGlobals();
});

describe('SettingsEvmSection', () => {
  it('shows chain and token prefs without advanced EVM UI', async () => {
    render(SettingsEvmSection);
    expect(await screen.findByText('Preferred network')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Advanced EVM accounts' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Advanced contract call' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add advanced account' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import private key' })).toBeNull();
  });
});
