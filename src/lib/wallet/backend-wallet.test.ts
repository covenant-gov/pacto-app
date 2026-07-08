import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { SupportedChainId } from './chains';
import {
  getEvmNativeBalance,
  getWalletSummary,
  walletBuildAndSendTransaction,
  walletWaitForTransaction,
  safeDeployProxy,
  parseWalletOpError,
  userFacingDeploySafeMessage,
  type WalletOpParsedError,
} from './backend-wallet';

function failureMessage<T extends { ok: true } | { ok: false; message: string }>(
  outcome: T,
): string {
  if (outcome.ok) throw new Error('expected failure outcome');
  return outcome.message;
}

function failureParsed<T extends { ok: true } | { ok: false; parsed?: WalletOpParsedError }>(
  outcome: T,
): WalletOpParsedError | undefined {
  if (outcome.ok) throw new Error('expected failure outcome');
  return outcome.parsed;
}

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

describe('backend-wallet', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getEvmNativeBalance', () => {
    it('returns an error when not in Tauri', async () => {
      vi.stubGlobal('window', undefined);
      const result = await getEvmNativeBalance('sepolia', '0xabc');
      expect(result.ok).toBe(false);
      expect(failureMessage(result)).toBe('Balances are only available in the desktop app.');
    });

    it('returns an error when the address is empty', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      const result = await getEvmNativeBalance('sepolia', '  ');
      expect(result.ok).toBe(false);
      expect(failureMessage(result)).toBe('Address is required.');
      expect(mockedInvoke).not.toHaveBeenCalled();
    });

    it('invokes get_evm_native_balance with trimmed address', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      const balance = { balanceRaw: '1000000000000000000', balanceDecimal: '1', symbol: 'ETH' };
      mockedInvoke.mockResolvedValueOnce(balance);
      const result = await getEvmNativeBalance('sepolia', '  0xabc  ');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.balance).toEqual(balance);
      expect(mockedInvoke).toHaveBeenCalledWith('get_evm_native_balance', {
        network: 'sepolia',
        address: '0xabc',
      });
    });

    it('returns the error message from a string rejection', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      mockedInvoke.mockRejectedValueOnce('rpc error');
      const result = await getEvmNativeBalance('sepolia', '0xabc');
      expect(result.ok).toBe(false);
      expect(failureMessage(result)).toBe('rpc error');
    });

    it('returns the error message from an Error rejection', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      mockedInvoke.mockRejectedValueOnce(new Error('node error'));
      const result = await getEvmNativeBalance('sepolia', '0xabc');
      expect(result.ok).toBe(false);
      expect(failureMessage(result)).toBe('node error');
    });

    it('returns a default message for unknown rejections', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      mockedInvoke.mockRejectedValueOnce(null);
      const result = await getEvmNativeBalance('sepolia', '0xabc');
      expect(result.ok).toBe(false);
      expect(failureMessage(result)).toBe('Could not load balance.');
    });
  });

  describe('getWalletSummary', () => {
    it('returns an error when not in Tauri', async () => {
      vi.stubGlobal('window', undefined);
      const result = await getWalletSummary([], ['sepolia']);
      expect(result.ok).toBe(false);
      expect(failureMessage(result)).toBe('Wallet summary is only available in the desktop app.');
    });

    it('invokes get_wallet_summary with watched tokens and enabled chains', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      const summary = { networks: [], totalUsdApprox: 0, prices: {} as never };
      mockedInvoke.mockResolvedValueOnce(summary);
      const watched = [{ network: 'sepolia', symbol: 'USDC', address: '0xabc', decimals: 6 }];
      const enabledChains: SupportedChainId[] = ['sepolia'];
      const result = await getWalletSummary(watched, enabledChains);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.summary).toEqual(summary);
      expect(mockedInvoke).toHaveBeenCalledWith('get_wallet_summary', {
        watchedErc20s: watched,
        enabledChains,
      });
    });

    it('returns the error message from a rejected invoke', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      mockedInvoke.mockRejectedValueOnce(new Error('summary failed'));
      const result = await getWalletSummary([], ['sepolia']);
      expect(result.ok).toBe(false);
      expect(failureMessage(result)).toBe('summary failed');
    });
  });

  describe('walletBuildAndSendTransaction', () => {
    it('returns an error when not in Tauri', async () => {
      vi.stubGlobal('window', undefined);
      const result = await walletBuildAndSendTransaction('npub', 'sepolia', 'ETH', '1');
      expect(result.ok).toBe(false);
      expect(failureMessage(result)).toBe('Sending is only available in the desktop app.');
    });

    it('invokes wallet_build_and_send_transaction with defaults', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      const sent = { txHash: '0x123', network: 'sepolia', chainId: 11155111 };
      mockedInvoke.mockResolvedValueOnce(sent);
      const result = await walletBuildAndSendTransaction(
        'npub1',
        'sepolia',
        'ETH',
        '  1.5  ',
        undefined,
        '  ',
        false,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.result).toEqual(sent);
      expect(mockedInvoke).toHaveBeenCalledWith('wallet_build_and_send_transaction', {
        toNpub: 'npub1',
        network: 'sepolia',
        asset: 'ETH',
        amount: '1.5',
        erc20Transfer: null,
        toAddressEvm: null,
        waitForConfirmation: false,
      });
    });

    it('includes an ERC-20 transfer and explicit EVM address when provided', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      const sent = { txHash: '0x123', network: 'sepolia', chainId: 11155111 };
      mockedInvoke.mockResolvedValueOnce(sent);
      const erc20 = { address: '0xToken', decimals: 6 };
      const result = await walletBuildAndSendTransaction(
        'npub1',
        'sepolia',
        'USDC',
        '10',
        erc20,
        '0xRecipient',
        true,
      );
      expect(result.ok).toBe(true);
      expect(mockedInvoke).toHaveBeenCalledWith('wallet_build_and_send_transaction', {
        toNpub: 'npub1',
        network: 'sepolia',
        asset: 'USDC',
        amount: '10',
        erc20Transfer: erc20,
        toAddressEvm: '0xRecipient',
        waitForConfirmation: true,
      });
    });

    it('parses a JSON error from a rejected invoke', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      const raw = '{"code":"SEND_FAILED","message":"insufficient funds"}';
      mockedInvoke.mockRejectedValueOnce(raw);
      const result = await walletBuildAndSendTransaction('npub1', 'sepolia', 'ETH', '1');
      expect(result.ok).toBe(false);
      expect(failureMessage(result)).toBe('insufficient funds');
      expect(failureParsed(result)).toEqual({ code: 'SEND_FAILED', message: 'insufficient funds' });
    });
  });

  describe('walletWaitForTransaction', () => {
    it('returns an error when not in Tauri', async () => {
      vi.stubGlobal('window', undefined);
      const result = await walletWaitForTransaction('sepolia', '0x123');
      expect(result.ok).toBe(false);
      expect(failureMessage(result)).toBe('Confirmation polling is only available in the desktop app.');
    });

    it('invokes wallet_wait_for_transaction with trimmed hash', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      const receipt = { txHash: '0x123', network: 'sepolia', chainId: 11155111 };
      mockedInvoke.mockResolvedValueOnce(receipt);
      const result = await walletWaitForTransaction('sepolia', '  0x123  ');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.result).toEqual(receipt);
      expect(mockedInvoke).toHaveBeenCalledWith('wallet_wait_for_transaction', {
        network: 'sepolia',
        txHash: '0x123',
      });
    });

    it('parses a JSON error from a rejected invoke', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      const raw = '{"code":"RECEIPT_TIMEOUT","message":"timeout"}';
      mockedInvoke.mockRejectedValueOnce(raw);
      const result = await walletWaitForTransaction('sepolia', '0x123');
      expect(result.ok).toBe(false);
      expect(failureParsed(result)?.code).toBe('RECEIPT_TIMEOUT');
    });
  });

  describe('safeDeployProxy', () => {
    it('returns an error when not in Tauri', async () => {
      vi.stubGlobal('window', undefined);
      const result = await safeDeployProxy('sepolia', ['0xOwner'], 1);
      expect(result.ok).toBe(false);
      expect(failureMessage(result)).toBe('Deploy is only available in the desktop app.');
    });

    it('invokes safe_deploy_proxy with null optional fields', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      const deployed = {
        txHash: '0xabc',
        safeAddress: '0xSafe',
        chain: 'sepolia',
        chainId: 11155111,
      };
      mockedInvoke.mockResolvedValueOnce(deployed);
      const result = await safeDeployProxy('sepolia', ['0xOwner'], 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.result).toEqual(deployed);
      expect(mockedInvoke).toHaveBeenCalledWith('safe_deploy_proxy', {
        network: 'sepolia',
        owners: ['0xOwner'],
        threshold: 1,
        saltNonce: null,
        parentId: null,
      });
    });

    it('trims parentId and preserves saltNonce when provided', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      mockedInvoke.mockResolvedValueOnce({
        txHash: '0xabc',
        safeAddress: '0xSafe',
        chain: 'sepolia',
        chainId: 11155111,
      });
      await safeDeployProxy('sepolia', ['0xOwner'], 1, '  salt  ', '  parent  ');
      expect(mockedInvoke).toHaveBeenCalledWith('safe_deploy_proxy', {
        network: 'sepolia',
        owners: ['0xOwner'],
        threshold: 1,
        saltNonce: '  salt  ',
        parentId: 'parent',
      });
    });

    it('returns a parsed JSON error from a rejected invoke', async () => {
      vi.stubGlobal('window', { __TAURI__: {} });
      mockedInvoke.mockRejectedValueOnce('{"code":"NO_EVM_KEY","message":"no key"}');
      const result = await safeDeployProxy('sepolia', ['0xOwner'], 1);
      expect(result.ok).toBe(false);
      expect(failureParsed(result)?.code).toBe('NO_EVM_KEY');
    });
  });

  describe('parseWalletOpError', () => {
    it('returns null for non-JSON strings', () => {
      expect(parseWalletOpError('plain error')).toBeNull();
      expect(parseWalletOpError('  ')).toBeNull();
    });

    it('returns null when required fields are missing', () => {
      expect(parseWalletOpError('{"code":"X"}')).toBeNull();
      expect(parseWalletOpError('{"message":"Y"}')).toBeNull();
    });

    it('parses a JSON error with optional fields', () => {
      const raw = '{"code":"X","message":"Y","npub":"npub1","txHash":"0x123"}';
      expect(parseWalletOpError(raw)).toEqual({
        code: 'X',
        message: 'Y',
        npub: 'npub1',
        txHash: '0x123',
      });
    });

    it('ignores extra fields', () => {
      const raw = '{"code":"X","message":"Y","extra":"ignored"}';
      expect(parseWalletOpError(raw)).toEqual({ code: 'X', message: 'Y' });
    });
  });

  describe('userFacingDeploySafeMessage', () => {
    it('returns a default message for an undefined error', () => {
      expect(userFacingDeploySafeMessage(undefined)).toBe('Deploy failed.');
    });

    it('shortens a long SEND_FAILED message', () => {
      const parsed: WalletOpParsedError = {
        code: 'SEND_FAILED',
        message: 'a'.repeat(150),
      };
      expect(userFacingDeploySafeMessage(parsed)).toContain('Check your native balance');
    });

    it('returns a friendly RPC_CONNECT message', () => {
      const parsed: WalletOpParsedError = {
        code: 'RPC_CONNECT',
        message: 'rpc failed',
      };
      expect(userFacingDeploySafeMessage(parsed)).toContain('ALCHEMY_RPC_KEY');
    });

    it('returns a friendly NO_EVM_KEY message', () => {
      const parsed: WalletOpParsedError = {
        code: 'NO_EVM_KEY',
        message: 'no key',
      };
      expect(userFacingDeploySafeMessage(parsed)).toContain('embedded wallet key');
    });

    it('returns the raw message for other codes', () => {
      const parsed: WalletOpParsedError = { code: 'OTHER', message: 'custom error' };
      expect(userFacingDeploySafeMessage(parsed)).toBe('custom error');
    });
  });
});
