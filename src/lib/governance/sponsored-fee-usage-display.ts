import { formatEther } from 'viem';

/** Prefer human action name; fall back to 4-byte selector. */
export function feeUsageActionLabel(row: { action: string; selector: string }): string {
  const action = row.action?.trim();
  if (action) return action;
  return row.selector?.trim() || '';
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
