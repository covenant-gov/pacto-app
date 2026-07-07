import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { getDmPeerEvmAddress, setDmPeerEvmAddress } from './wallet-peers';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe('wallet-peers command wrappers', () => {
  it('getDmPeerEvmAddress sends get_dm_peer_evm_address with peerNpub', async () => {
    mockedInvoke.mockResolvedValueOnce('0xabc');
    const result = await getDmPeerEvmAddress('npub1');
    expect(mockedInvoke).toHaveBeenCalledWith('get_dm_peer_evm_address', { peerNpub: 'npub1' });
    expect(result).toBe('0xabc');
  });

  it('setDmPeerEvmAddress sends set_dm_peer_evm_address with peer and address', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await setDmPeerEvmAddress('npub1', '0xabc');
    expect(mockedInvoke).toHaveBeenCalledWith('set_dm_peer_evm_address', {
      peerNpub: 'npub1',
      address: '0xabc',
    });
  });
});
