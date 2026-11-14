// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import EvmDashGasSection from './EvmDashGasSection.svelte';
import { loadGlobalSponsoredFeeUsage } from '../../lib/wallet/global-sponsored-fee-usage';
import { usernameGlobalSpendablePoolWei } from '../../lib/api/username';
import { clearEvmDashGasCache } from '../../lib/wallet/evm-dash-gas-cache';

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

async function openDisclosure() {
  await fireEvent.click(screen.getByText('Sponsored gas'));
  await tick();
}

beforeEach(() => {
  clearEvmDashGasCache();
  mockLoad.mockReset();
  mockPool.mockReset();
  mockLoad.mockResolvedValue([]);
  mockPool.mockResolvedValue('1000000000000000000');
});

afterEach(() => {
  cleanup();
  clearEvmDashGasCache();
});

describe('EvmDashGasSection', () => {
  it('loads 50 rows after the disclosure is opened and shows the ETH amount row', async () => {
    render(EvmDashGasSection);
    expect(mockLoad).not.toHaveBeenCalled();
    await openDisclosure();
    await waitFor(() => {
      expect(mockLoad).toHaveBeenCalledWith({ limit: 50 });
      expect(screen.getByText('No global sponsored fees yet')).toBeTruthy();
    });
    expect(screen.getByText('Global pool (Sepolia)')).toBeTruthy();
    expect(screen.getByText('ETH')).toBeTruthy();
    expect(screen.getByText('1.000000000000000000')).toBeTruthy();
    expect(screen.queryByText('1.000000000000000000 ETH spendable')).toBeNull();
  });

  it('shows the load error copy when the fee list fails', async () => {
    mockLoad.mockRejectedValueOnce(null);
    render(EvmDashGasSection);
    await openDisclosure();
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Could not load global sponsored fee usage',
      );
    });
  });

  it('does not refetch when the disclosure is closed and opened again', async () => {
    render(EvmDashGasSection);
    await openDisclosure();
    await waitFor(() => {
      expect(screen.getByText('1.000000000000000000')).toBeTruthy();
    });
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(mockPool).toHaveBeenCalledTimes(1);

    await openDisclosure();
    await tick();
    await openDisclosure();
    await tick();

    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(mockPool).toHaveBeenCalledTimes(1);
    expect(screen.getByText('1.000000000000000000')).toBeTruthy();
  });

  it('refetches when the refresh control is clicked', async () => {
    render(EvmDashGasSection);
    await openDisclosure();
    await waitFor(() => {
      expect(screen.getByText('1.000000000000000000')).toBeTruthy();
    });
    expect(mockLoad).toHaveBeenCalledTimes(1);

    const refresh = screen.getByRole('button', { name: 'Refresh global sponsored fee usage' });
    await fireEvent.click(refresh);
    await waitFor(() => {
      expect(mockLoad).toHaveBeenCalledTimes(2);
    });
    expect(mockPool).toHaveBeenCalledTimes(2);
  });
});
