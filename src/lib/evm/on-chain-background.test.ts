import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../stores/toast', () => ({
  showToast: vi.fn(),
}));

vi.mock('../wallet/backend-wallet', () => ({
  walletWaitForTransaction: vi.fn(),
  parseWalletOpError: vi.fn((raw: string) => {
    try {
      const j = JSON.parse(raw) as { code?: string; message?: string };
      if (j?.code || j?.message) return j;
    } catch {
      /* plain string */
    }
    return null;
  }),
}));

vi.mock('../utils/tauri-errors', () => ({
  getInvokeErrorMessage: vi.fn((e: unknown, fallback: string) =>
    e instanceof Error ? e.message : fallback,
  ),
}));

vi.mock('../wallet/assets', () => ({
  getExplorerTxUrl: vi.fn(() => null),
  explorerTxLinkLabel: vi.fn(() => 'explorer'),
}));

import { showToast } from '../../stores/toast';
import { walletWaitForTransaction } from '../wallet/backend-wallet';
import {
  runOnChainInBackground,
  waitForOnChainConfirmationInBackground,
} from './on-chain-background';

describe('runOnChainInBackground', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows started toast and calls onSuccess', async () => {
    const onSuccess = vi.fn();
    runOnChainInBackground({
      startedToast: 'started',
      job: async () => 42,
      onSuccess,
    });
    expect(showToast).toHaveBeenCalledWith('started');
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(42));
  });

  it('surfaces onError and error toast on failure', async () => {
    const onError = vi.fn();
    runOnChainInBackground({
      job: async () => {
        throw new Error('boom');
      },
      onError,
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('boom'));
    expect(showToast).toHaveBeenCalledWith('boom', undefined, undefined, { error: true });
  });
});

describe('waitForOnChainConfirmationInBackground', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onConfirmed when wait succeeds', async () => {
    vi.mocked(walletWaitForTransaction).mockResolvedValueOnce({
      ok: true,
      result: { network: 'sepolia', txHash: '0xabc' },
    } as never);
    const onConfirmed = vi.fn();
    waitForOnChainConfirmationInBackground('sepolia', '0xabc', { onConfirmed });
    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalled());
  });

  it('calls onFailed and error toast when wait fails without RECEIPT_TIMEOUT', async () => {
    vi.mocked(walletWaitForTransaction).mockResolvedValueOnce({
      ok: false,
      message: 'failed',
      parsed: { code: 'SEND_FAILED', message: 'failed' },
    } as never);
    const onFailed = vi.fn();
    waitForOnChainConfirmationInBackground('sepolia', '0xabc', { onFailed });
    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledWith('failed'));
    expect(showToast).toHaveBeenCalledWith('failed', undefined, undefined, { error: true });
  });

  it('suppresses RECEIPT_TIMEOUT: no onFailed, no error toast, chain settles', async () => {
    vi.mocked(walletWaitForTransaction).mockResolvedValueOnce({
      ok: false,
      message: 'receipt not available before timeout',
      parsed: { code: 'RECEIPT_TIMEOUT', message: 'receipt not available before timeout' },
    } as never);
    const onConfirmed = vi.fn();
    const onFailed = vi.fn();
    waitForOnChainConfirmationInBackground('sepolia', '0xabc', { onConfirmed, onFailed });
    // Drain the detached promise chain via microtasks (no wall-clock waits).
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(onFailed).not.toHaveBeenCalled();
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});
