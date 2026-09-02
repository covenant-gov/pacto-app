import { invoke } from './index';

export type UsernameRecordDto = {
  name: string;
  evmAddress: string;
  pendingAddress: string;
  tokenId: string;
};

export type UsernameEligibleMemberDto = {
  npubHash: string;
  tokenId: string;
};

export type UsernameClaimRow = {
  npub: string;
  username: string;
  npubHash: string;
  tokenId: string;
  linkEventId: string | null;
  policyVersion: number;
  network: string;
  updatedAtMs: number;
};

export type UsernameClaimResult = {
  network: string;
  chainId: number;
  path: string;
  username: string;
  npubHash: string;
  tokenId: string;
  linkEventId: string;
  txHash?: string;
  userOpHash?: string;
  evmAddress: string;
  policyVersion: number;
};

export type UsernameTransferResult = {
  network: string;
  chainId: number;
  path: string;
  npubHash: string;
  txHash?: string;
  userOpHash?: string;
  tokenId?: string;
  pendingAddress?: string;
};

export async function usernameNameAvailable(
  network: string,
  name: string,
  rpcUrls?: string[],
): Promise<boolean> {
  return invoke<boolean>('username_name_available', { network, name, rpcUrls });
}

export async function usernameCanBootstrapClaim(
  network: string,
  npubHash: string,
  member?: string,
  rpcUrls?: string[],
): Promise<boolean> {
  return invoke<boolean>('username_can_bootstrap_claim', {
    network,
    member: member ?? null,
    npubHash,
    rpcUrls,
  });
}

export async function usernameNpubOf(
  network: string,
  evmAddress: string,
  rpcUrls?: string[],
): Promise<string> {
  return invoke<string>('username_npub_of', { network, evmAddress, rpcUrls });
}

export async function usernameRecordOf(
  network: string,
  npubHash: string,
  rpcUrls?: string[],
): Promise<UsernameRecordDto> {
  return invoke<UsernameRecordDto>('username_record_of', { network, npubHash, rpcUrls });
}

export async function usernameEligibleMember(
  network: string,
  member: string,
  rpcUrls?: string[],
): Promise<UsernameEligibleMemberDto> {
  return invoke<UsernameEligibleMemberDto>('username_eligible_member', {
    network,
    member,
    rpcUrls,
  });
}

export async function usernameIsPendingTransfer(
  network: string,
  npubHash: string,
  rpcUrls?: string[],
): Promise<boolean> {
  return invoke<boolean>('username_is_pending_transfer', { network, npubHash, rpcUrls });
}

export async function usernameBootstrapSpendablePoolWei(
  network: string,
  rpcUrls?: string[],
): Promise<string> {
  return invoke<string>('username_bootstrap_spendable_pool_wei', { network, rpcUrls });
}

export async function usernameGlobalSpendablePoolWei(
  network: string,
  rpcUrls?: string[],
): Promise<string> {
  return invoke<string>('username_global_spendable_pool_wei', { network, rpcUrls });
}

export async function usernameMintFee(network: string, rpcUrls?: string[]): Promise<string> {
  return invoke<string>('username_mint_fee', { network, rpcUrls });
}

export async function usernameUsedNonce(
  network: string,
  npubHash: string,
  rpcUrls?: string[],
): Promise<string> {
  return invoke<string>('username_used_nonce', { network, npubHash, rpcUrls });
}

export async function usernameGetCachedClaim(): Promise<UsernameClaimRow | null> {
  return invoke<UsernameClaimRow | null>('username_get_cached_claim');
}

export async function usernameClaim(
  network: string,
  name: string,
  rpcUrls?: string[],
): Promise<UsernameClaimResult> {
  return invoke<UsernameClaimResult>('username_claim', { network, name, rpcUrls });
}

export async function usernameInitiateAddressTransfer(
  network: string,
  npubHash: string,
  newAddress: string,
  rpcUrls?: string[],
): Promise<UsernameTransferResult> {
  return invoke<UsernameTransferResult>('username_initiate_address_transfer', {
    network,
    npubHash,
    newAddress,
    rpcUrls,
  });
}

export async function usernameClaimAddressTransfer(
  network: string,
  npubHash: string,
  rpcUrls?: string[],
): Promise<UsernameTransferResult> {
  return invoke<UsernameTransferResult>('username_claim_address_transfer', {
    network,
    npubHash,
    rpcUrls,
  });
}

export async function usernameCancelAddressTransfer(
  network: string,
  npubHash: string,
  rpcUrls?: string[],
): Promise<UsernameTransferResult> {
  return invoke<UsernameTransferResult>('username_cancel_address_transfer', {
    network,
    npubHash,
    rpcUrls,
  });
}
