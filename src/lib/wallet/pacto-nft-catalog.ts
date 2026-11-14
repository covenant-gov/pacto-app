import { pactoProtocolNetworkBook } from '../evm/pacto-protocol-addresses';
import type { SupportedChainId } from './chains';

export type PactoNftKind = 'username';

export type PactoNftCatalogEntry = {
  kind: PactoNftKind;
  network: SupportedChainId;
  contract: string;
};

/** Known Pacto NFT contracts for a network. No chain crawl. */
export function pactoNftCatalog(network: SupportedChainId): PactoNftCatalogEntry[] {
  const contract = pactoProtocolNetworkBook(network)?.globalUsernameSponsor?.pactoUsernameNft?.trim();
  if (!contract) return [];
  return [{ kind: 'username', network, contract }];
}
