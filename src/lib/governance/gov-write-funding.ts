/** Copy for squad-key gov writes (EOA vs sponsored UserOp). */

export type GovWriteFundingMode = 'sponsored' | 'self_funded';

/** Short hint shown before submit when funding mode is known. */
export function govWriteFundingHint(mode: GovWriteFundingMode): string {
  if (mode === 'sponsored') {
    return 'Gas: sponsored from the squad sponsor pool (roster key has no ETH).';
  }
  return 'Gas: paid by your squad-assigned key.';
}

/**
 * When balance is unknown, explain both paths (bootstrap / QM / treasury writes).
 */
export function govWriteFundingFallbackHint(): string {
  return 'Gas: your squad-assigned key when it has ETH; otherwise a sponsored UserOp from the squad sponsor pool if you are eligible.';
}

/** 0 ETH roster and no sponsor infra — actionable before a raw insufficient-funds send. */
export function govWriteNoSponsorHint(): string {
  return 'Gas: your squad-assigned key has no ETH and no squad sponsor is deployed. Fund the roster key or deploy a squad sponsor first.';
}

/**
 * Approximate UI routing (backend still re-checks with a gas estimate).
 * - balance > 0 → self_funded
 * - balance 0 + sponsor → sponsored
 * - otherwise null (unknown balance, or 0 ETH without sponsor)
 */
export function resolveGovWriteFundingMode(input: {
  balanceRaw: string | null | undefined;
  balanceKnown: boolean;
  hasSponsorInfra: boolean;
}): GovWriteFundingMode | null {
  if (!input.balanceKnown) return null;
  let bal: bigint;
  try {
    const raw = (input.balanceRaw ?? '0').trim() || '0';
    if (!/^\d+$/.test(raw)) return null;
    bal = BigInt(raw);
  } catch {
    return null;
  }
  if (bal > 0n) return 'self_funded';
  if (input.hasSponsorInfra) return 'sponsored';
  return null;
}

/** Pick the best pre-submit gas line for governance CTAs. */
export function displayGovWriteFundingHint(input: {
  balanceRaw: string | null | undefined;
  balanceKnown: boolean;
  hasSponsorInfra: boolean;
}): string {
  const mode = resolveGovWriteFundingMode(input);
  if (mode) return govWriteFundingHint(mode);
  if (input.balanceKnown && !input.hasSponsorInfra) {
    let bal = 0n;
    try {
      const raw = (input.balanceRaw ?? '0').trim() || '0';
      if (/^\d+$/.test(raw)) bal = BigInt(raw);
    } catch {
      bal = 0n;
    }
    if (bal === 0n) return govWriteNoSponsorHint();
  }
  return govWriteFundingFallbackHint();
}
