import { invoke } from '@tauri-apps/api/core';

/** Mirrors `SquadInfraRow` from Tauri (`serde(rename_all = "camelCase")`). */
export interface SquadInfraDto {
  id: string;
  parentId: string;
  infraType: string;
  chain: string;
  canonicalRef: string;
  pactoGovRevision?: string;
  providerPayload?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

/** Dashboard compat until all surfaces use `infraType` directly. */
export function squadInfraLegacyProvider(infraType: string): string {
  if (infraType === 'standalone_safe') return 'gnosis_safe';
  return infraType;
}

export type ParentGovernanceDto = SquadInfraDto & { provider: string };

export function withLegacyProvider(row: SquadInfraDto): ParentGovernanceDto {
  return { ...row, provider: squadInfraLegacyProvider(row.infraType) };
}

/** Primary row for legacy single-row dashboard surfaces (prefers pacto_gov). */
export function primaryGovernanceView(
  rows: SquadInfraDto[] | undefined,
): ParentGovernanceDto | null | undefined {
  if (rows === undefined) return undefined;
  if (rows.length === 0) return null;
  const row =
    rows.find((r) => r.infraType === 'pacto_gov') ??
    rows.find((r) => r.infraType === 'standalone_safe') ??
    rows.find((r) => r.infraType !== 'pacto_gov_wargame');
  return row ? withLegacyProvider(row) : null;
}

/** Backend: `list_squad_infra`. */
export async function listSquadInfra(parentId: string): Promise<SquadInfraDto[]> {
  const rows = (await invoke('list_squad_infra', { parentId })) as SquadInfraDto[] | null | undefined;
  return rows ?? [];
}

/** Backend: `upsert_squad_infra`. */
export async function upsertSquadInfra(params: {
  id: string;
  parentId: string;
  infraType: string;
  chain?: string | null;
  canonicalRef: string;
  pactoGovRevision?: string | null;
  providerPayload?: string | null;
}): Promise<void> {
  await invoke('upsert_squad_infra', {
    id: params.id,
    parentId: params.parentId,
    infraType: params.infraType,
    chain: params.chain ?? null,
    canonicalRef: params.canonicalRef,
    pactoGovRevision: params.pactoGovRevision ?? null,
    providerPayload: params.providerPayload ?? null,
  });
}

/** Maps legacy announce / UI provider strings to squad infra types. */
export function infraTypeFromLegacyProvider(provider: string): string {
  const p = provider.trim().toLowerCase();
  if (p === 'gnosis_safe' || p === 'gnosis-safe' || p === 'safe') return 'standalone_safe';
  if (p === 'pacto-gov') return 'pacto_gov';
  if (p === 'squad_sponsor') return 'sponsor';
  if (p === 'squad_admin' || p === 'squad-admin') return 'squad_admin';
  return p;
}

/** Sponsor infra row for a parent, if any. */
export function sponsorInfraRow(rows: SquadInfraDto[] | undefined): SquadInfraDto | null {
  return rows?.find((r) => r.infraType === 'sponsor') ?? null;
}

export function hasSponsorInfra(rows: SquadInfraDto[] | undefined): boolean {
  return sponsorInfraRow(rows) != null;
}

/** Pacto-gov infra row for a parent, if any. Never matches `pacto_gov_wargame`. */
export function pactoGovInfraRow(rows: SquadInfraDto[] | undefined): SquadInfraDto | null {
  return rows?.find((r) => r.infraType === 'pacto_gov') ?? null;
}
