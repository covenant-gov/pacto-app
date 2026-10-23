// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import { appConfig, DEFAULT_APP_CONFIG } from '../../stores/app-config';
import { currentUser } from '../../stores/auth-session';
import { featureFlagOverrides, setFeatureFlagEnabled } from '../../stores/feature-flags';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import { settingsSectionCollapsed } from '../../lib/settings/settings-section-collapse';
import type { EvmAccountRow } from '../../lib/wallet/evm-accounts';
import WalletView from './WalletView.svelte';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const advancedAccount: EvmAccountRow = {
  id: 'existing-advanced-account',
  address: '0x1234567890123456789012345678901234567890',
  scheme: 'imported_private_key',
  hdIndex: null,
  label: 'Existing advanced account',
  purpose: 'advanced',
  isActive: false,
  isDefaultShared: false,
  isActiveAdvanced: true,
};

let accounts: EvmAccountRow[];

beforeEach(() => {
  accounts = [advancedAccount];
  window.__TAURI__ = {};
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  setCurrentNpubForPersistence(null);
  currentUser.set({ npub: 'npub1walletviewtest', pubkey: 'walletviewtest' });
  settingsSectionCollapsed.set({ 'settings-evm': false });
  appConfig.set({
    ...DEFAULT_APP_CONFIG,
    featureFlags: [{ key: 'advanced_evm_accounts', defaultEnabled: false }],
  });
  featureFlagOverrides.set({});
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) => {
    switch (command) {
      case 'get_evm_address':
        return advancedAccount.address;
      case 'list_evm_accounts':
        return accounts;
      case 'list_evm_account_squad_bindings':
      case 'list_squad_infra_canonical_refs':
        return [];
      default:
        throw new Error(`Unexpected command: ${command}`);
    }
  });
});

afterEach(() => {
  cleanup();
  delete window.__TAURI__;
  currentUser.set(null);
  settingsSectionCollapsed.set({});
  featureFlagOverrides.set({});
  appConfig.set(DEFAULT_APP_CONFIG);
  setCurrentNpubForPersistence(null);
  vi.unstubAllGlobals();
});

describe.each([
  { mode: 'settings', embeddedInSettings: true },
  { mode: 'standalone wallet', embeddedInSettings: false },
])('existing advanced accounts in $mode', ({ embeddedInSettings }) => {
  it.each(['default off', 'toggled off'] as const)(
    'preserves the account and usable contract panel when the flag is %s',
    async (flagState) => {
      if (flagState === 'toggled off') setFeatureFlagEnabled('advanced_evm_accounts', true);
      render(WalletView, { props: { embeddedInSettings } });

      await screen.findByTitle(advancedAccount.address);
      await screen.findByLabelText('Contract address (to)');
      if (flagState === 'toggled off') {
        expect(screen.getByRole('button', { name: 'Add advanced account' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Import private key' })).toBeTruthy();
        setFeatureFlagEnabled('advanced_evm_accounts', false);
        await tick();
      }

      expect(screen.getByTitle(advancedAccount.address)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Add advanced account' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Import private key' })).toBeNull();
      expect(screen.getByRole('heading', { name: 'Advanced contract call' })).toBeTruthy();
      await fireEvent.input(screen.getByLabelText('Contract address (to)'), {
        target: { value: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' },
      });
      const panel = screen.getByRole('region', { name: 'Advanced contract call' });
      await fireEvent.change(within(panel).getByRole('combobox', { name: 'Network' }), {
        target: { value: 'sepolia' },
      });
      expect((screen.getByRole('button', { name: 'Simulate (eth_call)' }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByRole('button', { name: 'Review & send' }) as HTMLButtonElement).disabled).toBe(false);

      if (embeddedInSettings) {
        const row = screen.getByTitle(advancedAccount.address).closest('li');
        expect(row).not.toBeNull();
        const exportButton = within(row!).getByRole('button', { name: 'Export key' });
        expect((exportButton as HTMLButtonElement).disabled).toBe(false);
        await fireEvent.click(exportButton);
        const dialog = await screen.findByRole('dialog', { name: 'Export private key' });
        expect(within(dialog).getByText(/Existing advanced account/)).toBeTruthy();
        expect(within(dialog).getByLabelText('PIN digit 1')).toBeTruthy();
      }
    },
  );
});

it('hides the advanced panel after opting out when no advanced account exists', async () => {
  accounts = [];
  render(WalletView, { props: { embeddedInSettings: true } });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('list_evm_accounts'));
  expect(screen.queryByRole('heading', { name: 'Advanced contract call' })).toBeNull();

  setFeatureFlagEnabled('advanced_evm_accounts', true);
  await screen.findByRole('heading', { name: 'Advanced contract call' });
  setFeatureFlagEnabled('advanced_evm_accounts', false);
  await tick();
  expect(screen.queryByRole('heading', { name: 'Advanced contract call' })).toBeNull();
});
