import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  usernameBootstrapSpendablePoolWei,
  usernameCanBootstrapClaim,
  usernameCancelAddressTransfer,
  usernameClaim,
  usernameClaimAddressTransfer,
  usernameEligibleMember,
  usernameGetCachedClaim,
  usernameGlobalSpendablePoolWei,
  usernameInitiateAddressTransfer,
  usernameIsPendingTransfer,
  usernameNameAvailable,
  usernameNpubOf,
  usernameRecordOf,
  usernameUsedNonce,
} from './username';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe('username API shapes', () => {
  it('username_name_available', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    await expect(usernameNameAvailable('sepolia', 'daopunk')).resolves.toBe(true);
    expect(mockedInvoke).toHaveBeenCalledWith('username_name_available', {
      network: 'sepolia',
      name: 'daopunk',
      rpcUrls: undefined,
    });
  });

  it('username_can_bootstrap_claim passes null member when omitted', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    await usernameCanBootstrapClaim('sepolia', '0xabc');
    expect(mockedInvoke).toHaveBeenCalledWith('username_can_bootstrap_claim', {
      network: 'sepolia',
      member: null,
      npubHash: '0xabc',
      rpcUrls: undefined,
    });
  });

  it('username_npub_of / record / eligible / pending', async () => {
    mockedInvoke.mockResolvedValueOnce('0x00');
    await usernameNpubOf('sepolia', '0x1111');
    expect(mockedInvoke).toHaveBeenCalledWith('username_npub_of', {
      network: 'sepolia',
      evmAddress: '0x1111',
      rpcUrls: undefined,
    });

    mockedInvoke.mockResolvedValueOnce({
      name: 'daopunk',
      evmAddress: '0x1111',
      pendingAddress: '0x0000000000000000000000000000000000000000',
      tokenId: '1',
    });
    await usernameRecordOf('sepolia', '0xabc');
    expect(mockedInvoke).toHaveBeenCalledWith('username_record_of', {
      network: 'sepolia',
      npubHash: '0xabc',
      rpcUrls: undefined,
    });

    mockedInvoke.mockResolvedValueOnce({ npubHash: '0xabc', tokenId: '1' });
    await usernameEligibleMember('sepolia', '0x1111');
    mockedInvoke.mockResolvedValueOnce(false);
    await usernameIsPendingTransfer('sepolia', '0xabc');
  });

  it('pool and nonce reads', async () => {
    mockedInvoke.mockResolvedValueOnce('0');
    await usernameBootstrapSpendablePoolWei('sepolia');
    expect(mockedInvoke).toHaveBeenCalledWith('username_bootstrap_spendable_pool_wei', {
      network: 'sepolia',
      rpcUrls: undefined,
    });

    mockedInvoke.mockResolvedValueOnce('0');
    await usernameGlobalSpendablePoolWei('sepolia');
    mockedInvoke.mockResolvedValueOnce('0');
    await usernameUsedNonce('sepolia', '0xabc');
  });

  it('username_claim and cache', async () => {
    mockedInvoke.mockResolvedValueOnce(null);
    await usernameGetCachedClaim();
    expect(mockedInvoke).toHaveBeenCalledWith('username_get_cached_claim');

    mockedInvoke.mockResolvedValueOnce({
      network: 'sepolia',
      chainId: 11155111,
      path: 'bootstrap',
      username: 'daopunk',
      npubHash: '0xabc',
      tokenId: '1',
      linkEventId: 'deadbeef',
      evmAddress: '0x1111',
      policyVersion: 3,
    });
    await usernameClaim('sepolia', 'daopunk');
    expect(mockedInvoke).toHaveBeenCalledWith('username_claim', {
      network: 'sepolia',
      name: 'daopunk',
      rpcUrls: undefined,
    });
  });

  it('rotation commands', async () => {
    mockedInvoke.mockResolvedValueOnce({
      network: 'sepolia',
      chainId: 11155111,
      path: 'eoa',
      npubHash: '0xabc',
    });
    await usernameInitiateAddressTransfer('sepolia', '0xabc', '0x2222');
    expect(mockedInvoke).toHaveBeenCalledWith('username_initiate_address_transfer', {
      network: 'sepolia',
      npubHash: '0xabc',
      newAddress: '0x2222',
      rpcUrls: undefined,
    });

    mockedInvoke.mockResolvedValueOnce({
      network: 'sepolia',
      chainId: 11155111,
      path: 'eoa',
      npubHash: '0xabc',
    });
    await usernameClaimAddressTransfer('sepolia', '0xabc');
    mockedInvoke.mockResolvedValueOnce({
      network: 'sepolia',
      chainId: 11155111,
      path: 'global_member',
      npubHash: '0xabc',
    });
    await usernameCancelAddressTransfer('sepolia', '0xabc');
  });
});
