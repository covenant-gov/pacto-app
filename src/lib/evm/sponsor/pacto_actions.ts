/**
 * Off-chain catalog of global sponsor lanes: username NFT, factory deploys, gov modules.
 *
 * Gov-module writes resolve `moduleToTopHat[target]` on-chain (no per-selector rows).
 */

import book from '../pacto-protocol-addresses.json';
import { sponsoredActionSelector } from './sponsored-actions';

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
    selector: sponsoredActionSelector('claimUsername'),
    lane: 'bootstrap',
  },
  {
    id: 'initiateAddressTransfer',
    targetKey: 'pactoUsernameNft',
    selector: sponsoredActionSelector('initiateAddressTransfer'),
    lane: 'member',
  },
  {
    id: 'claimAddressTransfer',
    targetKey: 'pactoUsernameNft',
    selector: sponsoredActionSelector('claimAddressTransfer'),
    lane: 'member',
  },
  {
    id: 'cancelAddressTransfer',
    targetKey: 'pactoUsernameNft',
    selector: sponsoredActionSelector('cancelAddressTransfer'),
    lane: 'member',
  },
] as const;

export const PACTO_FACTORY_ACTIONS: readonly PactoFactoryAction[] = [
  {
    id: 'deployNavePirata',
    targetKey: 'navePirataFactory',
    selector: sponsoredActionSelector('deployNavePirata'),
    lane: 'factory',
  },
  {
    id: 'createSquadSponsorExt',
    targetKey: 'squadSponsorFactory',
    selector: sponsoredActionSelector('createSquadSponsorExt'),
    lane: 'factory',
  },
  {
    id: 'createSquadSponsor',
    targetKey: 'squadSponsorFactory',
    selector: sponsoredActionSelector('createSquadSponsor'),
    lane: 'factory',
  },
  {
    id: 'createWarGameSponsor',
    targetKey: 'squadSponsorFactory',
    selector: sponsoredActionSelector('createWarGameSponsor'),
    lane: 'factory',
  },
  {
    id: 'deploySquadAdminExtStandalone',
    targetKey: 'navePirataFactory',
    selector: sponsoredActionSelector('deploySquadAdminExtStandalone'),
    lane: 'factory',
  },
  {
    id: 'deploySquadAdminStandaloneCaptainHat',
    targetKey: 'navePirataFactory',
    selector: sponsoredActionSelector('deploySquadAdminStandaloneCaptainHat'),
    lane: 'factory',
  },
  {
    id: 'createSafeProxy',
    targetKey: 'safeProxyFactory',
    selector: sponsoredActionSelector('createSafeProxy'),
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
