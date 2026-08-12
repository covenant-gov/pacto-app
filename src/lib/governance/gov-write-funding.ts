/** Copy for squad-key gov writes (EOA vs sponsored UserOp). */

import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

export type GovWriteFundingMode = 'sponsored' | 'self_funded';

function tFn(key: string, values?: Record<string, string>): string {
  return get(t)(key, values ? { values } : undefined);
}

/** Short hint shown before submit when funding mode is known. */
export function govWriteFundingHint(mode: GovWriteFundingMode): string {
  if (mode === 'sponsored') {
    return tFn('governance.funding.sponsored');
  }
  return tFn('governance.funding.selfFunded');
}

/**
 * When balance is unknown, explain both paths (bootstrap / QM / treasury writes).
 */
export function govWriteFundingFallbackHint(): string {
  return tFn('governance.funding.fallback');
}

/** 0 ETH roster and no sponsor infra — actionable before a raw insufficient-funds send. */
export function govWriteNoSponsorHint(): string {
  return tFn('governance.funding.noSponsor');
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

/** Success toast text including funding mode when known. */
export function govWriteSubmittedToast(
  label: string,
  mode: GovWriteFundingMode | null | undefined,
): string {
  if (mode === 'sponsored') {
    return tFn('governance.toast.submittedSponsored', { label });
  }
  if (mode === 'self_funded') {
    return tFn('governance.toast.submittedSelfFunded', { label });
  }
  return tFn('governance.toast.submitted', { label });
}
