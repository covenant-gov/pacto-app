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
