import type { PactoGovProviderPayloadV1 } from '$lib/governance/pacto-gov-payload';
import type { TreasurySafeEntry } from './treasury-safes';

/** Treasury section heading per product spec (Governance: Treasury vs Vault: name). */
export function treasuryVaultHeading(
  entry: TreasurySafeEntry,
  pactoPayload: PactoGovProviderPayloadV1 | null,
): string {
  const govSafe = pactoPayload?.safe?.trim().toLowerCase();
  if (govSafe && entry.safeAddress.trim().toLowerCase() === govSafe) {
    return 'Governance: Treasury';
  }
  const label = entry.label?.trim();
  if (label) return `Vault: ${label}`;
  return 'Vault: Multisig';
}
