import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPublicClient } from './client';

vi.mock('$lib/wallet/chains', () => ({
  createWalletPublicClient: vi.fn(),
  DEFAULT_CHAIN_ID: 'sepolia',
  SUPPORTED_CHAINS: {},
}));

import { createWalletPublicClient } from '$lib/wallet/chains';

describe('getPublicClient', () => {
  beforeEach(() => {
    vi.mocked(createWalletPublicClient).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a public client for the default chain when no chain id is given', () => {
    const fakeClient = { readContract: vi.fn() };
    vi.mocked(createWalletPublicClient).mockReturnValue(fakeClient as never);

    const result = getPublicClient();
    expect(createWalletPublicClient).toHaveBeenCalledWith('sepolia');
    expect(result).toBe(fakeClient);
  });

  it('creates a public client for the requested chain', () => {
    const fakeClient = { readContract: vi.fn() };
    vi.mocked(createWalletPublicClient).mockReturnValue(fakeClient as never);

    const result = getPublicClient('mainnet');
    expect(createWalletPublicClient).toHaveBeenCalledWith('mainnet');
    expect(result).toBe(fakeClient);
  });
});
