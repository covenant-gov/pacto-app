import type { SquadInfraDto } from './api';
import { pactoGovInfraRow, squadAdminInfraRow } from './api';
import { parsePactoGovProviderPayload } from './pacto-gov-payload';

/** Parsed `provider_payload` v1 from a squad-admin infra row. */
export interface SquadAdminProviderPayloadV1 {
  v?: number;
  parentId?: string;
  variant?: 'ext_standalone' | 'captain_hat';
  squadAdminProxy?: string;
  owner?: string;
  captainHatId?: string;
  implementation?: string;
  txHash?: string;
}

export function parseSquadAdminProviderPayload(
  raw: string | null | undefined,
): SquadAdminProviderPayloadV1 | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as SquadAdminProviderPayloadV1;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export interface ResolvedSquadAdminContext {
  proxy: string;
  chain: string;
  source: 'pacto_gov' | 'squad_admin';
  variant?: string;
}

/** Resolve squad-admin proxy from dedicated row or pacto-gov payload. */
export function resolveSquadAdminContext(
  rows: SquadInfraDto[] | undefined,
): ResolvedSquadAdminContext | null {
  const dedicated = squadAdminInfraRow(rows);
  if (dedicated) {
    const payload = parseSquadAdminProviderPayload(dedicated.providerPayload);
    const proxy = payload?.squadAdminProxy?.trim() || dedicated.canonicalRef?.trim();
    if (!proxy) return null;
    return {
      proxy,
      chain: dedicated.chain?.trim() || 'sepolia',
      source: 'squad_admin',
      variant: payload?.variant,
    };
  }
  const pacto = pactoGovInfraRow(rows);
  if (!pacto) return null;
  const payload = parsePactoGovProviderPayload(pacto.providerPayload);
  const proxy = payload?.squadAdminProxy?.trim();
  if (!proxy) return null;
  return {
    proxy,
    chain: pacto.chain?.trim() || 'sepolia',
    source: 'pacto_gov',
    variant: 'nave_pirata',
  };
}

export function hasSquadAdminInfra(rows: SquadInfraDto[] | undefined): boolean {
  return resolveSquadAdminContext(rows) != null;
}
