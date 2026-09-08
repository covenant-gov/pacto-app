/**
 * Off-chain catalog of global sponsor lanes: username NFT, factory deploys, gov modules.
 *
 * Gov-module writes resolve `moduleToTopHat[target]` on-chain (no per-selector rows).
 */

import book from '../pacto-protocol-addresses.json';

export type UsernameSponsorLane = 'bootstrap' | 'member';

/** Factory deploy txs (`isContractAllowed` + `eligibleMember`). */
export type FactorySponsorLane = 'factory';

/** Gov module writes (`moduleToTopHat` + `isTopHatSponsored` + `eligibleMember`). */
export type GovModuleSponsorLane = 'govModule';

export type SponsorLane = UsernameSponsorLane | FactorySponsorLane | GovModuleSponsorLane;

export type PactoActionId =
  | 'claimUsername'
  | 'initiateAddressTransfer'
  | 'claimAddressTransfer'
  | 'cancelAddressTransfer';

export type PactoFactoryActionId =
  | 'deployNavePirata'
  | 'createSquadSponsorExt'
  | 'createSquadSponsor'
  | 'createWarGameSponsor'
  | 'deploySquadAdminExtStandalone'
  | 'deploySquadAdminStandaloneCaptainHat'
  | 'createSafeProxy';

export type FactoryTargetKey = 'navePirataFactory' | 'squadSponsorFactory' | 'safeProxyFactory';

export type PactoAction = {
  id: PactoActionId;
  /** Logical target key in `globalUsernameSponsor` address book. */
  targetKey: 'pactoUsernameNft';
  selector: `0x${string}`;
  lane: UsernameSponsorLane;
};

export type PactoFactoryAction = {
  id: PactoFactoryActionId;
  targetKey: FactoryTargetKey;
  selector: `0x${string}`;
  lane: FactorySponsorLane;
};

export const PACTO_USERNAME_ACTIONS: readonly PactoAction[] = [
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

export const PACTO_FACTORY_ACTIONS: readonly PactoFactoryAction[] = [
  {
    id: 'deployNavePirata',
    targetKey: 'navePirataFactory',
    selector: '0xe5caf266',
    lane: 'factory',
  },
  {
    id: 'createSquadSponsorExt',
    targetKey: 'squadSponsorFactory',
    selector: '0x732ce718',
    lane: 'factory',
  },
  {
    id: 'createSquadSponsor',
    targetKey: 'squadSponsorFactory',
    selector: '0xd50506da',
    lane: 'factory',
  },
  {
    id: 'createWarGameSponsor',
    targetKey: 'squadSponsorFactory',
    selector: '0x4088bd34',
    lane: 'factory',
  },
  {
    id: 'deploySquadAdminExtStandalone',
    targetKey: 'navePirataFactory',
    selector: '0xfdcd0507',
    lane: 'factory',
  },
  {
    id: 'deploySquadAdminStandaloneCaptainHat',
    targetKey: 'navePirataFactory',
    selector: '0xf789af1f',
    lane: 'factory',
  },
  {
    id: 'createSafeProxy',
    targetKey: 'safeProxyFactory',
    selector: '0x1688f0b9',
    lane: 'factory',
  },
] as const;

/** @deprecated Use `PACTO_USERNAME_ACTIONS`; kept for existing imports. */
export const PACTO_ACTIONS = PACTO_USERNAME_ACTIONS;

export function getPactoAction(id: PactoActionId): PactoAction {
  const action = PACTO_USERNAME_ACTIONS.find((a) => a.id === id);
  if (!action) {
    throw new Error(`Unknown pacto action: ${id}`);
  }
  return action;
}

export function getPactoFactoryAction(id: PactoFactoryActionId): PactoFactoryAction {
  const action = PACTO_FACTORY_ACTIONS.find((a) => a.id === id);
  if (!action) {
    throw new Error(`Unknown pacto factory action: ${id}`);
  }
  return action;
}

export function factoryTargetAddress(
  targetKey: FactoryTargetKey,
  netKey: string = 'sepolia',
): string {
  const net = book.networks[netKey as keyof typeof book.networks];
  if (!net) {
    throw new Error(`No protocol address book entry for network ${netKey}`);
  }
  switch (targetKey) {
    case 'navePirataFactory':
      return net.pactoGov.navePirataFactory;
    case 'squadSponsorFactory':
      return net.squadSponsor.factory;
    case 'safeProxyFactory':
      return net.safe.proxyFactory;
    default:
      throw new Error(`Unknown factory target key: ${targetKey}`);
  }
}
