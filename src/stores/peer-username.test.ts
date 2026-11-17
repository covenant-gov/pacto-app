import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { usernameRecordForNpub } from '../lib/api/username';
import { ensurePeerUsername, peerUsernameClaims, resetPeerUsernames } from './peer-username';

vi.mock('../lib/api/username', () => ({
  usernameRecordForNpub: vi.fn(),
  usernameSyncAccountState: vi.fn(),
  usernameClaim: vi.fn(),
  usernameInitiateAddressTransfer: vi.fn(),
  usernameClaimAddressTransfer: vi.fn(),
  usernameCancelAddressTransfer: vi.fn(),
  usernameNameAvailable: vi.fn(),
}));

vi.mock('../lib/wallet/evm-accounts', () => ({
  getActiveSquadEvmSignerAddress: vi.fn(),
}));

vi.mock('../lib/api/nostr', () => ({
  publishBoundUsername: vi.fn(),
}));

const mockRecord = vi.mocked(usernameRecordForNpub);
const NPUB = 'npub1peerusernamecachetest';

describe('ensurePeerUsername', () => {
  beforeEach(() => {
    resetPeerUsernames();
    mockRecord.mockReset();
  });

  it('does not cache a failed read and retries on the next ensure', async () => {
    mockRecord.mockRejectedValueOnce(new Error('rpc'));
    ensurePeerUsername(NPUB);
    await vi.waitFor(() => expect(mockRecord).toHaveBeenCalledTimes(1));
    const first = mockRecord.mock.results[0]?.value as Promise<unknown> | undefined;
    await first?.catch(() => undefined);
    await Promise.resolve();
    expect(get(peerUsernameClaims)).not.toHaveProperty(NPUB);

    mockRecord.mockResolvedValueOnce({
      name: 'alice',
      evmAddress: '0x1111111111111111111111111111111111111111',
      pendingAddress: '0x0000000000000000000000000000000000000000',
      tokenId: '1',
    });
    ensurePeerUsername(NPUB);
    await vi.waitFor(() => expect(get(peerUsernameClaims)[NPUB]?.name).toBe('alice'));
    expect(mockRecord).toHaveBeenCalledTimes(2);
  });

  it('caches a confirmed miss', async () => {
    mockRecord.mockResolvedValueOnce({
      name: '',
      evmAddress: '0x0000000000000000000000000000000000000000',
      pendingAddress: '0x0000000000000000000000000000000000000000',
      tokenId: '0',
    });
    ensurePeerUsername(NPUB);
    await vi.waitFor(() => expect(get(peerUsernameClaims)[NPUB]).toEqual({ name: null }));
    ensurePeerUsername(NPUB);
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });
});
