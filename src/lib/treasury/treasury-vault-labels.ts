import type { TreasurySafeEntry } from './treasury-safes';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

/** Treasury section heading for standalone vault Safes (gov treasury uses a dedicated heading). */
export function treasuryVaultHeading(entry: TreasurySafeEntry): string {
  const label = entry.label?.trim();
  if (label) return get(t)('governance.treasury.vaultHeading', { values: { label } });
  return get(t)('governance.treasury.vaultHeadingMultisig');
}

/** Heading for the Pacto Gov governance treasury Safe section. */
export function governanceTreasuryHeading(): string {
  return get(t)('governance.treasury.heading');
}
