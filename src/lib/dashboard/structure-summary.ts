import type { SquadInfraDto } from '$lib/governance/api';
import { SUPPORTED_CHAINS, parseSupportedChainId, type SupportedChainId } from '$lib/wallet/chains';

const HATS_TREE_APP_ORIGIN = 'https://app.hatsprotocol.xyz';

/** Hat id suitable for `/trees/{chainId}/{hatId}` (decimal segment). */
export function normalizeHatIdPathSegment(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    if (/^0x[0-9a-fA-F]+$/.test(s)) {
      return BigInt(s).toString(10);
    }
    if (/^[0-9]+$/.test(s)) return s;
    return null;
  } catch {
    return null;
  }
}

/**
 * Official Hats Protocol tree explorer (`app.hatsprotocol.xyz`).
 * Returns null when the hat id cannot be normalized for the URL path.
 */
export function hatsTreeExplorerUrl(chainIdNumeric: number, hatIdRaw: string): string | null {
  const hatSegment = normalizeHatIdPathSegment(hatIdRaw);
  if (hatSegment == null || !Number.isFinite(chainIdNumeric)) return null;
  return `${HATS_TREE_APP_ORIGIN}/trees/${chainIdNumeric}/${hatSegment}`;
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
  hatsExplorerUrl: string | null;
}

/**
 * Maps governance SQLite row into Structure-tab summary.
 * `undefined`: row still hydrating; `null`: no Pacto Gov hat tree to show.
 */
export function resolveDashboardStructureSummary(
  governanceConfig: SquadInfraDto | null | undefined,
): DashboardStructureSummary | null | undefined {
  if (governanceConfig === undefined) return undefined;
  if (!governanceConfig || governanceConfig.infraType !== 'pacto_gov') return null;
  const treeIdRaw = governanceConfig.canonicalRef?.trim();
  if (!treeIdRaw) return null;
  const chainKey = parseSupportedChainId(governanceConfig.chain);
  const chainIdNumeric = SUPPORTED_CHAINS[chainKey].id;
  const hatsExplorerUrl = hatsTreeExplorerUrl(chainIdNumeric, treeIdRaw);
  return {
    chainKey,
    chainIdNumeric,
    chainDisplayName: governanceChainDisplayName(chainKey),
    treeIdRaw,
    hatsExplorerUrl,
  };
}
