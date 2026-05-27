import type { SquadInfraDto } from './api';
import { pactoGovInfraRow } from './api';
import { parsePactoGovProviderPayload, type PactoGovProviderPayloadV1 } from './pacto-gov-payload';

/** Parsed `provider_payload` v1 from a standalone Safe infra row. */
export interface StandaloneSafeProviderPayloadV1 {
  v?: number;
  treasuryEntryId?: string;
  label?: string;
  safe_address?: string;
  tx_hash?: string;
}

export function parseStandaloneSafeProviderPayload(
  raw: string | null | undefined,
): StandaloneSafeProviderPayloadV1 | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as StandaloneSafeProviderPayloadV1;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function standaloneSafeInfraRows(rows: SquadInfraDto[] | undefined): SquadInfraDto[] {
  return rows?.filter((r) => r.infraType === 'standalone_safe') ?? [];
}

/** Whether this treasury Safe is the pacto-gov governance treasury (not a separate vault). */
export function isPactoGovTreasurySafe(
  safeAddress: string,
  pactoPayload: PactoGovProviderPayloadV1 | null,
): boolean {
  const gov = pactoPayload?.safe?.trim().toLowerCase();
  if (!gov) return false;
  return safeAddress.trim().toLowerCase() === gov;
}

export function pactoGovPayloadFromInfra(rows: SquadInfraDto[] | undefined): PactoGovProviderPayloadV1 | null {
  const row = pactoGovInfraRow(rows);
  return parsePactoGovProviderPayload(row?.providerPayload);
}

export function buildStandaloneSafeProviderPayload(params: {
  treasuryEntryId: string;
  safeAddress: string;
  label?: string;
  txHash?: string;
}): string {
  return JSON.stringify({
    v: 1,
    treasuryEntryId: params.treasuryEntryId,
    safe_address: params.safeAddress,
    ...(params.label?.trim() ? { label: params.label.trim() } : {}),
    ...(params.txHash?.trim() ? { tx_hash: params.txHash.trim() } : {}),
  });
}
