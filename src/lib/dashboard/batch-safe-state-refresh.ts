import type { TreasurySafeEntry } from '../treasury/treasury-safes';
import { refreshSafeStateForTreasuryEntry } from '../../stores/safe';

/** Refresh Safe on-chain state for treasury rows; RPC concurrency capped in `stores/safe.ts`. */
export async function refreshAllSafeStates(
  entries: TreasurySafeEntry[],
  opts?: { force?: boolean },
): Promise<void> {
  if (!entries.length) return;
  await Promise.all(entries.map((entry) => refreshSafeStateForTreasuryEntry(entry, opts)));
}
