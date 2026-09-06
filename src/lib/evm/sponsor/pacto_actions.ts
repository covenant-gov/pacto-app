/**
 * Off-chain catalog of username NFT actions → sponsor lane + selector.
 * Catalog `policyVersion` must be ≥ on-chain `SponsorPolicyRegistry.policyVersion()`.
 */

import book from '../pacto-protocol-addresses.json';

export type SponsorLane = 'bootstrap' | 'member';

export type PactoActionId =
  | 'claimUsername'
  | 'initiateAddressTransfer'
  | 'claimAddressTransfer'
  | 'cancelAddressTransfer';

export type PactoAction = {
  id: PactoActionId;
  /** Logical target key in `globalUsernameSponsor` address book. */
  targetKey: 'pactoUsernameNft';
  selector: `0x${string}`;
  lane: SponsorLane;
};

/** Local catalog version; bump when member-policy selectors change. */
export const PACTO_ACTIONS_POLICY_VERSION = 4 as const;

export const PACTO_ACTIONS: readonly PactoAction[] = [
  {
    id: 'claimUsername',
    targetKey: 'pactoUsernameNft',
    // claim(string,bytes32,bytes32,uint256,uint256,bytes32,bytes,bytes)
    selector: '0x9824550d',
    lane: 'bootstrap',
  },
  {
    id: 'initiateAddressTransfer',
    targetKey: 'pactoUsernameNft',
    selector: '0xa4df29b5',
    lane: 'member',
  },
  {
    id: 'claimAddressTransfer',
    targetKey: 'pactoUsernameNft',
    selector: '0xbf010955',
    lane: 'member',
  },
  {
    id: 'cancelAddressTransfer',
    targetKey: 'pactoUsernameNft',
    selector: '0xd88208dc',
    lane: 'member',
  },
] as const;

export function getPactoAction(id: PactoActionId): PactoAction {
  const action = PACTO_ACTIONS.find((a) => a.id === id);
  if (!action) {
    throw new Error(`Unknown pacto action: ${id}`);
  }
  return action;
}

/**
 * Fails when the local catalog is behind on-chain policy.
 * Call before building a global member UserOp.
 */
export function assertCatalogPolicyVersion(onChainVersion: number | bigint): void {
  const onChain = typeof onChainVersion === 'bigint' ? Number(onChainVersion) : onChainVersion;
  if (!Number.isFinite(onChain) || onChain < 0) {
    throw new Error('Invalid on-chain policyVersion');
  }
  if (PACTO_ACTIONS_POLICY_VERSION < onChain) {
    throw new Error(
      `pacto_actions catalog policyVersion ${PACTO_ACTIONS_POLICY_VERSION} is behind on-chain ${onChain}`,
    );
  }
}

/** Sepolia book policyVersion must match the catalog constant. */
export function bookPolicyVersion(netKey: string = 'sepolia'): number {
  const section =
    book.networks[netKey as keyof typeof book.networks]?.globalUsernameSponsor;
  if (!section) {
    throw new Error(`No globalUsernameSponsor for network ${netKey}`);
  }
  return section.policyVersion;
}
