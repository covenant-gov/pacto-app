/** One Safe linked to a squad/network parent (persisted in `parent_treasury_safe`). */
export interface TreasurySafeEntry {
  id: string;
  parentId: string;
  safeAddress: string;
  chain: string;
  label: string;
  createdAtMs: number;
}

export const TREASURY_SAFE_UI_CAP = 10;

/** Max co-owners selectable in the Deploy Safe flow (UI limit; chain contract allows more). */
export const DEPLOY_SAFE_MAX_SIGNERS = 10;

/** Treasury tab vaults only — excludes the Pacto Gov governance treasury row. */
export function vaultTreasurySafesForParent(
  safes: TreasurySafeEntry[],
  parentId: string,
  govTreasuryEntryId: (parentId: string) => string,
): TreasurySafeEntry[] {
  const pid = parentId.trim();
  if (!pid) return safes;
  const excludeId = govTreasuryEntryId(pid);
  return safes.filter((e) => e.id !== excludeId);
}

/** Pacto Gov governance treasury Safe — first-class Treasury section, not a generic vault card. */
export function governanceTreasurySafeForParent(
  safes: TreasurySafeEntry[],
  parentId: string,
  govTreasuryEntryId: (parentId: string) => string,
  opts?: { safeAddress?: string; chain?: string },
): TreasurySafeEntry | null {
  const pid = parentId.trim();
  if (!pid) return null;
  const id = govTreasuryEntryId(pid);
  const found = safes.find((e) => e.id === id);
  if (found) return found;
  const addr = opts?.safeAddress?.trim();
  if (!addr) return null;
  return {
    id,
    parentId: pid,
    safeAddress: addr,
    chain: opts?.chain?.trim() || 'sepolia',
    label: '',
    createdAtMs: 0,
  };
}
