import { usernameEligibleMember } from '../api/username';
import { squadRpcUrlsForInvoke } from '../squad/squad-rpc-invoke';
import type { SupportedChainId } from '../wallet/chains';

export type UsernameNftEligibility = {
  squadSignerEligible: boolean;
  captainEligible: boolean;
};

/** Best-effort username NFT sponsorship hint for deploy pay-gas UI. */
export async function fetchUsernameNftDeployEligibility(params: {
  network: SupportedChainId | string;
  parentId: string;
  squadSignerAddress: string | null;
  captainAddress: string | null;
}): Promise<UsernameNftEligibility> {
  const network = params.network.trim();
  const squad = params.squadSignerAddress?.trim() ?? '';
  const captain = params.captainAddress?.trim() ?? '';
  if (!network || (!squad && !captain)) {
    return { squadSignerEligible: false, captainEligible: false };
  }

  const rpcUrls = squadRpcUrlsForInvoke(params.parentId, network) ?? undefined;
  const check = async (member: string): Promise<boolean> => {
    if (!member) return false;
    try {
      const row = await usernameEligibleMember(network, member, rpcUrls);
      return !!row?.tokenId?.trim();
    } catch {
      return false;
    }
  };

  const [squadSignerEligible, captainEligible] = await Promise.all([
    check(squad),
    check(captain),
  ]);
  return { squadSignerEligible, captainEligible };
}

/** Show the NFT sponsor note when the selected payer may use global username sponsorship. */
export function showUsernameNftSponsorNote(input: {
  payFrom: 'default' | 'squad';
  eligibility: UsernameNftEligibility;
}): boolean {
  if (input.payFrom === 'squad') {
    return input.eligibility.squadSignerEligible;
  }
  return input.eligibility.captainEligible || input.eligibility.squadSignerEligible;
}
