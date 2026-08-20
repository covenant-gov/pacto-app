import type { SquadInfraDto } from '$lib/governance/api';
import { hatsTreeDomain } from '$lib/governance/pretty-hat-id';
import { SUPPORTED_CHAINS, parseSupportedChainId, type SupportedChainId } from '$lib/wallet/chains';

const HATS_TREE_APP_ORIGIN = 'https://app.hatsprotocol.xyz';

/** Tree domain for `/trees/{chainId}/{treeId}` (bare domain or high 32 bits of a hat id). */
export function normalizeHatIdPathSegment(raw: string): string | null {
  return hatsTreeDomain(raw);
}

/**
 * Official Hats Protocol tree explorer (`app.hatsprotocol.xyz`).
 * Path uses the tree domain (e.g. `950`), not the full top-hat uint256.
 */
export function hatsTreeExplorerUrl(chainIdNumeric: number, hatIdRaw: string): string | null {
  const treeSegment = normalizeHatIdPathSegment(hatIdRaw);
  if (treeSegment == null || !Number.isFinite(chainIdNumeric)) return null;
  return `${HATS_TREE_APP_ORIGIN}/trees/${chainIdNumeric}/${treeSegment}`;
}

function governanceChainDisplayName(key: SupportedChainId): string {
  switch (key) {
    case 'mainnet':
      return 'Ethereum';
    case 'arbitrum':
      return 'Arbitrum';
    case 'sepolia':
      return 'Sepolia';
    case 'local':
      return 'Local Anvil';
  }
}

export interface DashboardStructureSummary {
  chainKey: SupportedChainId;
  chainIdNumeric: number;
  chainDisplayName: string;
  /** Stored canonical ref for this deployment (`topHatId` for Pacto Gov). */
  treeIdRaw: string;
  /** Hats tree domain used in explorer URLs (e.g. `950`). */
  treeDomain: string | null;
  hatsExplorerUrl: string | null;
}

/**
 * Maps a hat-tree infra row into Structure-tab summary.
 * `undefined`: row still hydrating; `null`: no Pacto Gov or war-game hat tree to show.
 */
export function resolveDashboardStructureSummary(
  governanceConfig: SquadInfraDto | null | undefined,
): DashboardStructureSummary | null | undefined {
  if (governanceConfig === undefined) return undefined;
  if (!governanceConfig || (governanceConfig.infraType !== 'pacto_gov' && governanceConfig.infraType !== 'pacto_gov_wargame')) return null;
  const treeIdRaw = governanceConfig.canonicalRef?.trim();
  if (!treeIdRaw) return null;
  const chainKey = parseSupportedChainId(governanceConfig.chain);
  const chainIdNumeric = SUPPORTED_CHAINS[chainKey].id;
  const treeDomain = hatsTreeDomain(treeIdRaw);
  const hatsExplorerUrl = hatsTreeExplorerUrl(chainIdNumeric, treeIdRaw);
  return {
    chainKey,
    chainIdNumeric,
    chainDisplayName: governanceChainDisplayName(chainKey),
    treeIdRaw,
    treeDomain,
    hatsExplorerUrl,
  };
}
