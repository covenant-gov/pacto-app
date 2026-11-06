import { formatEther } from 'viem';

import { sponsoredActionName } from '../evm/sponsor/sponsored-actions';

const FOUR_BYTE_SELECTOR = /^0x[0-9a-fA-F]{8}$/;

/** Prefer a stored function name. Resolve a stored 4-byte selector from the catalog. */
export function feeUsageActionLabel(row: { action: string; selector: string }): string {
  const action = row.action?.trim() ?? '';
  const selector = row.selector?.trim() ?? '';
  if (action && !FOUR_BYTE_SELECTOR.test(action)) return action;
  return (
    (action ? sponsoredActionName(action) : null) ??
    (selector ? sponsoredActionName(selector) : null) ??
    (action || selector)
  );
}

/** Wei decimal string → ETH decimal, or null if invalid. */
export function feeUsageAmountEth(amountWei: string): string | null {
  try {
    return formatEther(BigInt(amountWei.trim() || '0'));
  } catch {
    return null;
  }
}

export function truncateNpub(npub: string, head = 10, tail = 4): string {
  const trimmed = npub.trim();
  if (trimmed.length <= head + tail + 1) return trimmed;
  return `${trimmed.slice(0, head)}…${trimmed.slice(-tail)}`;
}
