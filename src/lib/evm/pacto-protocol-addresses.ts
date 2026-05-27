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

export type PactoProtocolNetworkBook = {
  chainId: number;
  meta?: { deployer?: string };
  squadSponsor?: SquadSponsorProtocolAddresses;
  pactoGov?: PactoGovProtocolAddresses;
  safe?: SafeProtocolAddresses;
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
