// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

vi.mock('../../lib/wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/wallet')>();
  return {
    ...actual,
    getWalletSummary: vi.fn(async () => ({ ok: false, message: 'not fetched in test' })),
    walletBuildAndSendTransaction: vi.fn(),
    walletWaitForTransaction: vi.fn(),
  };
});

vi.mock('../../lib/wallet/pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/wallet/pricing')>();
  return {
    ...actual,
    getWalletUsdSpotPrices: vi.fn(async () => ({ ok: false, message: 'not fetched in test' })),
  };
});

vi.mock('../../lib/wallet/evm-accounts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/wallet/evm-accounts')>();
  return {
    ...actual,
    setActiveEvmAccount: vi.fn(async () => {}),
  };
});

vi.mock('../../lib/evm/on-chain-background', () => ({
  waitForOnChainConfirmationInBackground: vi.fn(),
}));

import WalletHomeSendModal from './WalletHomeSendModal.svelte';
import type { WatchedErc20Row } from '../../lib/wallet/watched-tokens';
import { getWalletSummary, walletBuildAndSendTransaction } from '../../lib/wallet';
import { setActiveEvmAccount } from '../../lib/wallet/evm-accounts';
import { backupVerified } from '../../stores/backup-verification';

const VIEWED = '0x1111111111111111111111111111111111111111';

afterEach(() => {
  cleanup();
});

describe('WalletHomeSendModal reset guard', () => {
  it('never overwrites in-progress edits while the modal stays open across an unrelated re-render', async () => {
    const onClose = vi.fn();
    const rows: WatchedErc20Row[] = [];
    const { rerender } = render(WalletHomeSendModal, {
      props: { open: true, onClose, watchedAssetRows: rows, enabledChainIds: ['mainnet', 'sepolia'] },
    });

    const addressInput = screen.getByLabelText('Recipient EVM address') as HTMLInputElement;
    const amountInput = screen.getByLabelText('Amount') as HTMLInputElement;

    await fireEvent.input(addressInput, { target: { value: '0x1234567890123456789012345678901234567890' } });
    await fireEvent.input(amountInput, { target: { value: '2.5' } });
    expect(addressInput.value).toBe('0x1234567890123456789012345678901234567890');
    expect(amountInput.value).toBe('2.5');

    // Unrelated re-render (new watchedAssetRows array reference, modal stays open) must not
    // re-run the close-reset guard and wipe what the user just typed -- this is the same
    // loop/overwrite risk a bare $effect on `open` alone would introduce if it also read
    // toAddress/amountStr.
    await rerender({ open: true, onClose, watchedAssetRows: [...rows], enabledChainIds: ['mainnet', 'sepolia'] });

    expect(addressInput.value).toBe('0x1234567890123456789012345678901234567890');
    expect(amountInput.value).toBe('2.5');
  });

  it('clears the form once the modal closes so the next open starts blank', async () => {
    const onClose = vi.fn();
    const { rerender } = render(WalletHomeSendModal, {
      props: { open: true, onClose, watchedAssetRows: [], enabledChainIds: ['mainnet', 'sepolia'] },
    });

    const addressInput = screen.getByLabelText('Recipient EVM address') as HTMLInputElement;
    await fireEvent.input(addressInput, { target: { value: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' } });
    expect(addressInput.value).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');

    // Close, then reopen.
    await rerender({ open: false, onClose, watchedAssetRows: [], enabledChainIds: ['mainnet', 'sepolia'] });
    await rerender({ open: true, onClose, watchedAssetRows: [], enabledChainIds: ['mainnet', 'sepolia'] });

    const addressInputAfterReopen = screen.getByLabelText('Recipient EVM address') as HTMLInputElement;
    expect(addressInputAfterReopen.value).toBe('');
  });
});

describe('WalletHomeSendModal signer switch', () => {
  afterEach(() => {
    vi.mocked(getWalletSummary).mockClear();
    vi.mocked(setActiveEvmAccount).mockClear();
    vi.mocked(walletBuildAndSendTransaction).mockReset();
    backupVerified.set(null);
  });

  it('loads the viewed address and switches the signer only on confirm', async () => {
    backupVerified.set(true);
    vi.mocked(walletBuildAndSendTransaction).mockResolvedValue({
      ok: true,
      result: { txHash: '0xabc', network: 'sepolia', chainId: 11155111 },
    });
    const onClose = vi.fn();
    const onSignerActivated = vi.fn(async () => {});
    render(WalletHomeSendModal, {
      props: {
        open: true,
        onClose,
        watchedAssetRows: [],
        enabledChainIds: ['sepolia'],
        fromAccount: { id: 'acct-2', address: VIEWED, isActive: false },
        onSignerActivated,
      },
    });

    await vi.waitFor(() => {
      expect(getWalletSummary).toHaveBeenCalledWith(expect.anything(), ['sepolia'], VIEWED);
    });
    expect(setActiveEvmAccount).not.toHaveBeenCalled();

    await fireEvent.input(screen.getByLabelText('Recipient EVM address'), {
      target: { value: '0x2222222222222222222222222222222222222222' },
    });
    await fireEvent.input(screen.getByLabelText('Amount'), { target: { value: '1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await vi.waitFor(() => {
      expect(walletBuildAndSendTransaction).toHaveBeenCalled();
    });
    expect(setActiveEvmAccount).toHaveBeenCalledWith('acct-2');
    expect(vi.mocked(setActiveEvmAccount).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(walletBuildAndSendTransaction).mock.invocationCallOrder[0],
    );
    expect(onSignerActivated).toHaveBeenCalled();
  });
});
