// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

vi.mock('../../lib/wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/wallet')>();
  return {
    ...actual,
    getWalletSummary: vi.fn(async () => ({ ok: false, message: 'not fetched in test' })),
    walletBuildAndSendTransaction: vi.fn(),
  };
});

vi.mock('../../lib/wallet/pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/wallet/pricing')>();
  return {
    ...actual,
    getWalletUsdSpotPrices: vi.fn(async () => ({ ok: false, message: 'not fetched in test' })),
  };
});

import WalletTransferStubModal from './WalletTransferStubModal.svelte';
import { walletBuildAndSendTransaction } from '../../lib/wallet';
import { backupVerified } from '../../stores/backup-verification';
import type { WalletSendPrefillPayload } from '../../stores/app';

vi.mock('../../lib/api/wallet-peers', () => ({
  getDmPeerEvmAddress: vi.fn(async () => null),
  setDmPeerEvmAddress: vi.fn(async () => {}),
}));

vi.mock('../../lib/wallet/wallet-dm-transfer', () => ({
  finalizeWalletDmTransferAfterBroadcast: vi.fn(async () => {}),
  toastWalletBroadcastSubmitted: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

function prefill(overrides: Partial<WalletSendPrefillPayload> = {}): WalletSendPrefillPayload {
  return {
    targetNpub: 'npub1peer',
    network: 'mainnet',
    asset: 'ETH',
    amount: '1.5',
    requestId: 'req-1',
    requestMessageId: 'msg-1',
    toEvmAddress: '0x1111111111111111111111111111111111111111',
    ...overrides,
  };
}

describe('WalletTransferStubModal prefill guard', () => {
  it('applies formPrefill once on open and never overwrites an edit made after it lands', async () => {
    const onClose = vi.fn();
    const { rerender } = render(WalletTransferStubModal, {
      props: {
        mode: 'send',
        npub: 'npub1peer',
        peerDisplayName: 'Peer',
        onClose,
        formPrefill: prefill(),
      },
    });

    const amountInput = screen.getByLabelText('Amount') as HTMLInputElement;
    const networkSelect = screen.getByLabelText('Network') as HTMLSelectElement;
    expect(amountInput.value).toBe('1.5');
    expect(networkSelect.value).toBe('mainnet');

    // User edits the amount after the prefill has already been applied.
    await fireEvent.input(amountInput, { target: { value: '9.99' } });
    expect(amountInput.value).toBe('9.99');

    // An unrelated re-render (same prefill request) must not re-run the guard and
    // stomp the user's edit -- this is the exact loop/overwrite risk a naive bare
    // $effect on formPrefill would introduce.
    await rerender({
      mode: 'send',
      npub: 'npub1peer',
      peerDisplayName: 'Peer (renamed)',
      onClose,
      formPrefill: prefill(),
    });

    expect(amountInput.value).toBe('9.99');
    expect(networkSelect.value).toBe('mainnet');
  });

  it('applies a new prefill (distinct request) after the previous one was cleared', async () => {
    const onClose = vi.fn();
    const { rerender } = render(WalletTransferStubModal, {
      props: {
        mode: 'send',
        npub: 'npub1peer',
        peerDisplayName: 'Peer',
        onClose,
        formPrefill: prefill(),
      },
    });

    const amountInput = screen.getByLabelText('Amount') as HTMLInputElement;
    expect(amountInput.value).toBe('1.5');

    // Prefill withdrawn (e.g. Send opened directly, no accepted request).
    await rerender({
      mode: 'send',
      npub: 'npub1peer',
      peerDisplayName: 'Peer',
      onClose,
      formPrefill: null,
    });

    // A second, distinct request arrives -- must apply since it is a new key.
    await rerender({
      mode: 'send',
      npub: 'npub1peer',
      peerDisplayName: 'Peer',
      onClose,
      formPrefill: prefill({ amount: '3', requestId: 'req-2', requestMessageId: 'msg-2' }),
    });

    expect(amountInput.value).toBe('3');
  });

  it('pays a request at the address on the request, not the saved peer address', async () => {
    backupVerified.set(true);
    const to = '0x2222222222222222222222222222222222222222';
    vi.mocked(walletBuildAndSendTransaction).mockResolvedValue({
      ok: true,
      result: { txHash: '0xabc', network: 'mainnet', chainId: 1 },
    });
    render(WalletTransferStubModal, {
      props: {
        mode: 'send',
        npub: 'npub1peer',
        peerDisplayName: 'Peer',
        onClose: vi.fn(),
        postDmPlaintext: vi.fn(async () => true),
        formPrefill: prefill({ toEvmAddress: to }),
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(walletBuildAndSendTransaction).toHaveBeenCalledWith(
      'npub1peer',
      'mainnet',
      'ETH',
      '1.5',
      undefined,
      to,
      false,
    );
  });
});
