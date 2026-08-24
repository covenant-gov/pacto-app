import type { TreasurySafeEntry } from './treasury-safes';

/** Treasury section heading for standalone vault Safes (gov treasury uses a dedicated heading). */
export function treasuryVaultHeading(entry: TreasurySafeEntry): string {
  const label = entry.label?.trim();
  if (label) return `Vault: ${label}`;
  return 'Vault: Multisig';
}

/** Heading for the Pacto Gov governance treasury Safe section. */
export function governanceTreasuryHeading(): string {
  return 'Treasury';
}
