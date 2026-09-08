import { parseEther } from 'viem';

/** Parse optional ETH deposit; empty string is zero. */
export function parseOptionalDepositWei(amountTrimmed: string): bigint | null {
  if (!amountTrimmed) return 0n;
  try {
    const wei = parseEther(amountTrimmed.replace(/,/g, ''));
    return wei >= 0n ? wei : null;
  } catch {
    return null;
  }
}
