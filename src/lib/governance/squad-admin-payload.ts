import type { SquadInfraDto } from './api';
import { pactoGovInfraRow, pactoGovWargameInfraRow, squadAdminInfraRow } from './api';
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
  source: 'pacto_gov' | 'squad_admin' | 'pacto_gov_wargame';
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

/** Squad Admin on the war-game stack. Never dual-read as live `pacto_gov`. */
export function resolveWarGameSquadAdminContext(
  row: SquadInfraDto | null | undefined,
): ResolvedSquadAdminContext | null {
  if (!row || row.infraType !== 'pacto_gov_wargame') return null;
  const payload = parsePactoGovProviderPayload(row.providerPayload);
  const proxy = payload?.squadAdminProxy?.trim();
  if (!proxy) return null;
  return {
    proxy,
    chain: row.chain?.trim() || 'sepolia',
    source: 'pacto_gov_wargame',
    variant: 'nave_pirata',
  };
}

export function hasSquadAdminInfra(rows: SquadInfraDto[] | undefined): boolean {
  return resolveSquadAdminContext(rows) != null;
}

/** Dashboard state for a squad whose only governance infra is a standalone Squad Admin. */
export interface StandaloneSquadAdminState {
  proxy: string;
  chain: string;
  variant: 'ext_standalone' | 'captain_hat';
}

/** Non-null only for a dedicated `squad_admin` row with no `pacto_gov` row alongside it. */
export function resolveStandaloneSquadAdminState(
  rows: SquadInfraDto[] | undefined,
): StandaloneSquadAdminState | null {
  if (pactoGovInfraRow(rows) != null) return null;
  const ctx = resolveSquadAdminContext(rows);
  if (ctx?.source !== 'squad_admin') return null;
  return {
    proxy: ctx.proxy,
    chain: ctx.chain,
    variant: ctx.variant === 'captain_hat' ? 'captain_hat' : 'ext_standalone',
  };
}

/** Settings is stack-agnostic: live Squad Admin first, then war-game fallback. */
export function resolveSettingsPrivilegesAdmin(
  rows: SquadInfraDto[] | undefined,
): ResolvedSquadAdminContext | null {
  return (
    resolveSquadAdminContext(rows) ??
    resolveWarGameSquadAdminContext(pactoGovWargameInfraRow(rows))
  );
}

/** Revision on the Settings Privileges card; follows the resolved admin stack. */
export function settingsPrivilegesRevision(
  rows: SquadInfraDto[] | undefined,
  ctx: ResolvedSquadAdminContext | null = resolveSettingsPrivilegesAdmin(rows),
): string {
  if (ctx?.source === 'pacto_gov_wargame') {
    return pactoGovWargameInfraRow(rows)?.pactoGovRevision?.trim() ?? '';
  }
  const live =
    pactoGovInfraRow(rows)?.pactoGovRevision?.trim() ||
    squadAdminInfraRow(rows)?.pactoGovRevision?.trim() ||
    '';
  if (live) return live;
  if (ctx) return '';
  return pactoGovWargameInfraRow(rows)?.pactoGovRevision?.trim() ?? '';
}
