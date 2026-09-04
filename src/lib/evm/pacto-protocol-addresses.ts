import book from './pacto-protocol-addresses.json';
import type { SupportedChainId } from '../wallet/chains';

export type PactoProtocolNetworkKey = keyof typeof book.networks;

export type SquadSponsorProtocolAddresses = {
  factory: string;
  paymaster: string;
  entryPoint: string;
  navePirataRegistry?: string;
};

export type PactoGovProtocolAddresses = {
  navePirataFactory: string;
  navePirataRegistry?: string;
  warGameRegistry?: string;
  masterQuartermaster: string;
  masterMutiny: string;
  masterTreasuryAuthority: string;
  masterSquadAdminImpl: string;
  masterSquadAdminExtImpl: string;
  hats?: string;
  roleHatClonesFactory?: string;
  roleHatUpgrader?: string;
};

export type SafeProtocolAddresses = {
  proxyFactory: string;
  singleton: string;
  fallbackHandler: string;
};

export type Erc4337ProtocolAddresses = {
  accountImplementation?: string;
};

export type GlobalUsernameSponsorProtocolAddresses = {
  protocolRegistry: string;
  usernameSystemFactory: string;
  pactoUsernameNft: string;
  globalSponsorPool: string;
  bootstrapMintPool: string;
  sponsorPolicyRegistry: string;
  bootstrapClaimPolicy: string;
  pactoGlobalPaymaster: string;
  nostrClaimLink: string;
  policyVersion: number;
  allowed7702Implementation: string;
  entryPoint: string;
};

export type PactoProtocolNetworkBook = {
  chainId: number;
  meta?: { deployer?: string };
  globalUsernameSponsor?: GlobalUsernameSponsorProtocolAddresses;
  squadSponsor?: SquadSponsorProtocolAddresses;
  pactoGov?: PactoGovProtocolAddresses;
  safe?: SafeProtocolAddresses;
  erc4337?: Erc4337ProtocolAddresses;
};

const NETWORKS = book.networks as Record<string, PactoProtocolNetworkBook>;

/** Tracked protocol address book (same JSON embedded in Rust `pacto_chain_config`). */
export function pactoProtocolNetworkBook(
  netKey: SupportedChainId | string
): PactoProtocolNetworkBook | undefined {
  return NETWORKS[netKey];
}

export function pactoProtocolBookVersion(): number {
  return book.version;
}
