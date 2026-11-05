// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import EvmDashGasSection from './EvmDashGasSection.svelte';
import { loadGlobalSponsoredFeeUsage } from '../../lib/wallet/global-sponsored-fee-usage';
import { usernameGlobalSpendablePoolWei } from '../../lib/api/username';
import { setSettingsSectionCollapsed } from '../../lib/settings/settings-section-collapse';

vi.mock('../../lib/wallet/global-sponsored-fee-usage', async () => {
  const actual = await vi.importActual<typeof import('../../lib/wallet/global-sponsored-fee-usage')>(
    '../../lib/wallet/global-sponsored-fee-usage',
  );
  return {
    ...actual,
    loadGlobalSponsoredFeeUsage: vi.fn(),
  };
});

vi.mock('../../lib/api/username', () => ({
  usernameGlobalSpendablePoolWei: vi.fn(),
}));

const mockLoad = vi.mocked(loadGlobalSponsoredFeeUsage);
const mockPool = vi.mocked(usernameGlobalSpendablePoolWei);

beforeEach(() => {
  setSettingsSectionCollapsed('settings-evm-dash-gas', false);
  mockLoad.mockReset();
  mockPool.mockReset();
  mockLoad.mockResolvedValue([]);
  mockPool.mockResolvedValue('1000000000000000000');
});

afterEach(() => {
  cleanup();
  setSettingsSectionCollapsed('settings-evm-dash-gas', true);
});

describe('EvmDashGasSection', () => {
  it('loads 50 rows and shows the network pool label and empty state', async () => {
    render(EvmDashGasSection);
    await waitFor(() => {
      expect(screen.getByText('No global sponsored fees yet')).toBeTruthy();
    });
    expect(mockLoad).toHaveBeenCalledWith({ limit: 50 });
    expect(screen.getByText('Global pool (Sepolia)')).toBeTruthy();
    expect(screen.getByText('1 ETH spendable')).toBeTruthy();
  });

  it('shows the load error copy when the fee list fails', async () => {
    mockLoad.mockRejectedValueOnce(null);
    render(EvmDashGasSection);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Could not load global sponsored fee usage',
      );
    });
  });
});
