import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Abi, Address } from 'viem';

vi.mock('../wallet/chains', () => ({
  createWalletPublicClient: vi.fn(),
  DEFAULT_CHAIN_ID: 'sepolia',
  SUPPORTED_CHAINS: {},
}));

vi.mock('./read-plane-limiter', () => ({
  withReadPlaneLimit: (fn: () => Promise<unknown>) => fn(),
}));

import { createWalletPublicClient } from '../wallet/chains';
import type { Mock } from 'vitest';
import {
  ReadPlaneError,
  readContract,
  multicall,
  simulateContractCall,
  getReadOnlyContract,
} from './read-plane';

describe('read-plane', () => {
  let fakeClient: {
    readContract: Mock;
    multicall: Mock;
    call: Mock;
  };

  beforeEach(() => {
    fakeClient = {
      readContract: vi.fn(),
      multicall: vi.fn(),
      call: vi.fn(),
    };
    vi.mocked(createWalletPublicClient).mockReset().mockReturnValue(fakeClient as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ReadPlaneError', () => {
    it('carries a code and message', () => {
      const err = new ReadPlaneError('READ_CONTRACT_FAILED', 'boom');
      expect(err.code).toBe('READ_CONTRACT_FAILED');
      expect(err.message).toBe('boom');
      expect(err.name).toBe('ReadPlaneError');
    });
  });

  describe('readContract', () => {
    it('returns the contract result', async () => {
      fakeClient.readContract.mockResolvedValueOnce(42n);
      const abi = [{ type: 'function', name: 'count', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }] as Abi;
      const result = await readContract({
        chainId: 'sepolia',
        address: '0x1111111111111111111111111111111111111111' as Address,
        abi,
        functionName: 'count',
      });
      expect(result).toBe(42n);
      expect(fakeClient.readContract).toHaveBeenCalledWith({
        address: '0x1111111111111111111111111111111111111111',
        abi,
        functionName: 'count',
        args: undefined,
      });
    });

    it('passes args when provided', async () => {
      fakeClient.readContract.mockResolvedValueOnce(1n);
      const abi = [{ type: 'function', name: 'balanceOf', inputs: [{ type: 'address', name: 'account' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }] as Abi;
      await readContract({
        chainId: 'sepolia',
        address: '0x1111111111111111111111111111111111111111' as Address,
        abi,
        functionName: 'balanceOf',
        args: ['0x2222222222222222222222222222222222222222'],
      });
      expect(fakeClient.readContract).toHaveBeenCalledWith(expect.objectContaining({
        functionName: 'balanceOf',
        args: ['0x2222222222222222222222222222222222222222'],
      }));
    });

    it('wraps errors in a ReadPlaneError', async () => {
      fakeClient.readContract.mockRejectedValueOnce(new Error('revert'));
      const abi = [{ type: 'function', name: 'count', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }] as Abi;
      await expect(readContract({
        chainId: 'sepolia',
        address: '0x1111111111111111111111111111111111111111' as Address,
        abi,
        functionName: 'count',
      })).rejects.toBeInstanceOf(ReadPlaneError);
    });
  });

  describe('multicall', () => {
    it('returns an empty array when there are no contracts', async () => {
      const result = await multicall({ chainId: 'sepolia', contracts: [] });
      expect(result).toEqual([]);
      expect(fakeClient.multicall).not.toHaveBeenCalled();
    });

    it('returns multicall results', async () => {
      fakeClient.multicall.mockResolvedValueOnce([1n, 2n]);
      const result = await multicall({
        chainId: 'sepolia',
        contracts: [
          {
            address: '0x1111111111111111111111111111111111111111' as Address,
            abi: [{ type: 'function', name: 'a', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }] as Abi,
            functionName: 'a',
          },
          {
            address: '0x2222222222222222222222222222222222222222' as Address,
            abi: [{ type: 'function', name: 'b', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }] as Abi,
            functionName: 'b',
          },
        ],
      });
      expect(result).toEqual([1n, 2n]);
      expect(fakeClient.multicall).toHaveBeenCalled();
    });

    it('wraps errors in a ReadPlaneError', async () => {
      fakeClient.multicall.mockRejectedValueOnce(new Error('multicall revert'));
      await expect(multicall({
        chainId: 'sepolia',
        contracts: [{
          address: '0x1111111111111111111111111111111111111111' as Address,
          abi: [{ type: 'function', name: 'a', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }] as Abi,
          functionName: 'a',
        }],
      })).rejects.toBeInstanceOf(ReadPlaneError);
    });
  });

  describe('simulateContractCall', () => {
    it('returns ok when the call succeeds', async () => {
      fakeClient.call.mockResolvedValueOnce({ data: '0x' });
      const result = await simulateContractCall({
        chainId: 'sepolia',
        to: '0x1111111111111111111111111111111111111111' as Address,
        data: '0x',
      });
      expect(result).toEqual({ ok: true });
      expect(fakeClient.call).toHaveBeenCalledWith(expect.objectContaining({
        to: '0x1111111111111111111111111111111111111111',
        value: 0n,
        data: '0x',
      }));
    });

    it('passes value and from when provided', async () => {
      fakeClient.call.mockResolvedValueOnce({ data: '0x' });
      await simulateContractCall({
        chainId: 'sepolia',
        from: '0x2222222222222222222222222222222222222222' as Address,
        to: '0x1111111111111111111111111111111111111111' as Address,
        valueWei: 1000n,
        data: '0xdeadbeef',
      });
      expect(fakeClient.call).toHaveBeenCalledWith({
        account: '0x2222222222222222222222222222222222222222',
        to: '0x1111111111111111111111111111111111111111',
        value: 1000n,
        data: '0xdeadbeef',
      });
    });

    it('returns ok:false with the revert message', async () => {
      fakeClient.call.mockRejectedValueOnce(new Error('execution reverted'));
      const result = await simulateContractCall({
        chainId: 'sepolia',
        to: '0x1111111111111111111111111111111111111111' as Address,
        data: '0x',
      });
      expect(result).toEqual({ ok: false, message: 'execution reverted' });
    });
  });

  describe('getReadOnlyContract', () => {
    it('returns a contract bound to the requested address and chain', () => {
      const abi = [{ type: 'function', name: 'count', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }] as Abi;
      const contract = getReadOnlyContract({
        chainId: 'sepolia',
        address: '0x1111111111111111111111111111111111111111' as Address,
        abi,
      });
      expect(contract).toBeDefined();
      expect(createWalletPublicClient).toHaveBeenCalledWith('sepolia');
    });
  });
});
