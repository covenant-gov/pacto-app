import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPublicClient } from '$lib/wallet/client';
import { getSafeState } from './safe';

vi.mock('$lib/wallet/client', () => ({
  getPublicClient: vi.fn(),
}));

const MOCK_ADDRESS = '0x1111111111111111111111111111111111111111';

describe('getSafeState', () => {
  beforeEach(() => {
    vi.mocked(getPublicClient).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads owners, threshold, nonce, and balance from a Safe contract', async () => {
    const mockClient = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === 'getOwners') return [MOCK_ADDRESS];
        if (functionName === 'getThreshold') return 2n;
        if (functionName === 'nonce') return 5n;
        throw new Error(`Unexpected function ${functionName}`);
      }),
      getBalance: vi.fn().mockResolvedValue(10_000_000_000_000_000n),
    };
    vi.mocked(getPublicClient).mockReturnValue(mockClient as never);

    const state = await getSafeState(MOCK_ADDRESS);

    expect(state).toEqual({
      address: MOCK_ADDRESS,
      owners: [MOCK_ADDRESS],
      threshold: 2,
      nonce: 5n,
      balanceWei: 10_000_000_000_000_000n,
      balanceFormatted: '0.01',
    });
    expect(mockClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MOCK_ADDRESS,
        functionName: 'getOwners',
      }),
    );
    expect(mockClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MOCK_ADDRESS,
        functionName: 'getThreshold',
      }),
    );
    expect(mockClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MOCK_ADDRESS,
        functionName: 'nonce',
      }),
    );
    expect(mockClient.getBalance).toHaveBeenCalledWith({ address: MOCK_ADDRESS });
  });

  it('uses the provided chain id', async () => {
    const mockClient = {
      readContract: vi.fn().mockResolvedValue([]),
      getBalance: vi.fn().mockResolvedValue(0n),
    };
    vi.mocked(getPublicClient).mockReturnValue(mockClient as never);

    await getSafeState(MOCK_ADDRESS, 'mainnet');
    expect(getPublicClient).toHaveBeenCalledWith('mainnet');
  });
});
