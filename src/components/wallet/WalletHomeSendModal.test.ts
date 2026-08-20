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

import WalletHomeSendModal from './WalletHomeSendModal.svelte';
import type { WatchedErc20Row } from '../../lib/wallet/watched-tokens';

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
