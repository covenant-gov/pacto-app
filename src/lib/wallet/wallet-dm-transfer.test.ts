import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../stores/dm', () => ({
  appendPendingOutboundDmMessage: vi.fn().mockReturnValue('opt-id'),
  patchOutboundWalletTxByHash: vi.fn(),
  backendDmMessages: {
    subscribe: vi.fn((fn: (v: Record<string, DmMessage[]>) => void) => {
      fn({});
      return () => {};
    }),
    set: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../stores/toast', () => ({
  showToast: vi.fn(),
}));

vi.mock('../evm/on-chain-background', () => ({
  toastOnChainSubmitted: vi.fn(),
  toastOnChainConfirmed: vi.fn(),
}));

vi.mock('./backend-wallet', () => ({
  walletWaitForTransaction: vi.fn(),
}));

vi.mock('./evm-accounts', () => ({
  getActiveEvmSignerAddress: vi.fn(),
}));

vi.mock('./dm-messages', () => ({
  formatWalletTxAnnouncement: vi.fn().mockReturnValue('ann-content'),
  parseWalletTxAnnouncement: vi.fn(),
  isWalletTxAnnouncementOnChainPending: vi.fn(),
}));

import { appendPendingOutboundDmMessage, patchOutboundWalletTxByHash } from '../../stores/dm';
import { showToast } from '../../stores/toast';
import { toastOnChainSubmitted, toastOnChainConfirmed } from '../evm/on-chain-background';
import { walletWaitForTransaction } from './backend-wallet';
import { getActiveEvmSignerAddress } from './evm-accounts';
import { formatWalletTxAnnouncement, parseWalletTxAnnouncement, isWalletTxAnnouncementOnChainPending } from './dm-messages';
import type { DmMessage } from '../../stores/dm';

describe('wallet-dm-transfer', () => {
  let mod: typeof import('./wallet-dm-transfer');

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.mocked(appendPendingOutboundDmMessage).mockReset().mockReturnValue('opt-id');
    vi.mocked(patchOutboundWalletTxByHash).mockReset();
    vi.mocked(showToast).mockReset();
    vi.mocked(toastOnChainSubmitted).mockReset();
    vi.mocked(toastOnChainConfirmed).mockReset();
    vi.mocked(walletWaitForTransaction).mockReset();
    vi.mocked(getActiveEvmSignerAddress).mockReset();
    vi.mocked(formatWalletTxAnnouncement).mockReset().mockReturnValue('ann-content');
    vi.mocked(parseWalletTxAnnouncement).mockReset();
    vi.mocked(isWalletTxAnnouncementOnChainPending).mockReset();
    mod = await import('./wallet-dm-transfer');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('toastWalletBroadcastSubmitted', () => {
    it('delegates to toastOnChainSubmitted', () => {
      const result = { txHash: '0xabc', network: 'sepolia', chainId: 11155111 } as const;
      mod.toastWalletBroadcastSubmitted(result);
      expect(toastOnChainSubmitted).toHaveBeenCalledWith('sepolia', '0xabc', 'Transaction');
    });
  });

  describe('finalizeWalletDmTransferAfterBroadcast', () => {
    const params = {
      peerNpub: 'npub1peer',
      network: 'sepolia' as const,
      asset: 'ETH',
      amount: '1',
      txHash: '0xabc',
      fromNpub: 'npub1me',
      sendDm: vi.fn().mockResolvedValue(true),
      onBalanceRefresh: vi.fn(),
    };

    it('shows a toast and skips the optimistic note when there is no active signer', async () => {
      vi.mocked(getActiveEvmSignerAddress).mockResolvedValue(null);
      await mod.finalizeWalletDmTransferAfterBroadcast(params);
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('no active EVM address'));
      expect(appendPendingOutboundDmMessage).not.toHaveBeenCalled();
      expect(walletWaitForTransaction).not.toHaveBeenCalled();
    });

    it('posts an optimistic note and finalizes on confirmation', async () => {
      vi.mocked(getActiveEvmSignerAddress).mockResolvedValue('0xFrom');
      vi.mocked(walletWaitForTransaction).mockResolvedValue({
        ok: true,
        result: { txHash: '0xabc', network: 'sepolia', chainId: 11155111, blockNumber: '123' },
      });
      params.sendDm.mockResolvedValue(true);

      await mod.finalizeWalletDmTransferAfterBroadcast(params);
      await vi.runAllTimersAsync();

      expect(formatWalletTxAnnouncement).toHaveBeenCalled();
      expect(appendPendingOutboundDmMessage).toHaveBeenCalledWith('npub1peer', 'ann-content');
      expect(walletWaitForTransaction).toHaveBeenCalledWith('sepolia', '0xabc');
      expect(patchOutboundWalletTxByHash).toHaveBeenCalledWith(
        'npub1peer',
        '0xabc',
        expect.objectContaining({ pending: false, failed: false }),
      );
      expect(params.sendDm).toHaveBeenCalledWith('ann-content');
      expect(params.onBalanceRefresh).toHaveBeenCalled();
      expect(toastOnChainConfirmed).toHaveBeenCalledWith('sepolia', '0xabc', 'Transfer');
    });

    it('shows a timeout toast when the receipt times out', async () => {
      vi.mocked(getActiveEvmSignerAddress).mockResolvedValue('0xFrom');
      vi.mocked(walletWaitForTransaction).mockResolvedValue({
        ok: false,
        message: 'timeout',
        parsed: { code: 'RECEIPT_TIMEOUT', message: 'timeout' },
      });

      const promise = mod.finalizeWalletDmTransferAfterBroadcast(params);
      await vi.advanceTimersByTimeAsync(15_000 * 25);
      await promise;

      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('still waiting'));
      expect(patchOutboundWalletTxByHash).not.toHaveBeenCalled();
    });

    it('marks the optimistic card as failed on a non-timeout error', async () => {
      vi.mocked(getActiveEvmSignerAddress).mockResolvedValue('0xFrom');
      vi.mocked(walletWaitForTransaction).mockResolvedValue({
        ok: false,
        message: 'reverted',
        parsed: { code: 'OTHER', message: 'reverted' },
      });

      await mod.finalizeWalletDmTransferAfterBroadcast(params);
      await vi.runAllTimersAsync();

      expect(patchOutboundWalletTxByHash).toHaveBeenCalledWith(
        'npub1peer',
        '0xabc',
        expect.objectContaining({ pending: false, failed: true }),
      );
      expect(showToast).toHaveBeenCalledWith('reverted');
    });
  });

  describe('resumePendingWalletTxConfirmations', () => {
    const ctx = {
      fromNpub: 'npub1me',
      sendDm: vi.fn().mockResolvedValue(true),
      onBalanceRefresh: vi.fn(),
    };

    it('does nothing for non-mine or non-pending messages', async () => {
      const messages = [
        { id: '1', mine: false, content: 'hello' },
        { id: '2', mine: true, content: 'not an announcement' },
      ] as DmMessage[];
      vi.mocked(parseWalletTxAnnouncement).mockReturnValue(null);
      vi.mocked(isWalletTxAnnouncementOnChainPending).mockReturnValue(false);

      mod.resumePendingWalletTxConfirmations('npub1peer', messages, ctx);
      await Promise.resolve();

      expect(walletWaitForTransaction).not.toHaveBeenCalled();
    });

    it('resumes a pending wallet announcement and confirms it', async () => {
      const messages = [
        {
          id: '1',
          mine: true,
          content: 'wallet announcement',
          pending: true,
          failed: false,
        },
      ] as DmMessage[];
      vi.mocked(parseWalletTxAnnouncement).mockReturnValue({
        network: 'sepolia',
        asset: 'ETH',
        amount: '1',
        tx_hash: '0xabc',
        from_npub: 'npub1me',
        to_npub: 'npub1peer',
        from_evm_address: '0xFrom',
      } as never);
      vi.mocked(isWalletTxAnnouncementOnChainPending).mockReturnValue(true);
      vi.mocked(getActiveEvmSignerAddress).mockResolvedValue('0xFrom');
      vi.mocked(walletWaitForTransaction).mockResolvedValue({
        ok: true,
        result: { txHash: '0xabc', network: 'sepolia', chainId: 11155111, blockNumber: '123' },
      });

      mod.resumePendingWalletTxConfirmations('npub1peer', messages, ctx);
      await vi.runAllTimersAsync();

      expect(walletWaitForTransaction).toHaveBeenCalledWith('sepolia', '0xabc');
      expect(patchOutboundWalletTxByHash).toHaveBeenCalled();
      expect(ctx.sendDm).toHaveBeenCalled();
    });

    it('marks the card as failed when confirmation fails', async () => {
      const messages = [
        {
          id: '1',
          mine: true,
          content: 'wallet announcement',
          pending: true,
          failed: false,
        },
      ] as DmMessage[];
      vi.mocked(parseWalletTxAnnouncement).mockReturnValue({
        network: 'sepolia',
        asset: 'ETH',
        amount: '1',
        tx_hash: '0xabc',
      } as never);
      vi.mocked(isWalletTxAnnouncementOnChainPending).mockReturnValue(true);
      vi.mocked(getActiveEvmSignerAddress).mockResolvedValue('0xFrom');
      vi.mocked(walletWaitForTransaction).mockResolvedValue({
        ok: false,
        message: 'reverted',
        parsed: { code: 'OTHER', message: 'reverted' },
      });

      mod.resumePendingWalletTxConfirmations('npub1peer', messages, ctx);
      await vi.runAllTimersAsync();

      expect(patchOutboundWalletTxByHash).toHaveBeenCalledWith(
        'npub1peer',
        '0xabc',
        expect.objectContaining({ pending: false, failed: true }),
      );
    });
  });
});
