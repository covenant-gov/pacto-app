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
