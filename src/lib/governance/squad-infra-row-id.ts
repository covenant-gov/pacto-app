import { keccak256, stringToBytes } from 'viem';

/** Mirrors `SQUAD_INFRA_ID_MAX` in `src-tauri/src/db.rs`. */
export const SQUAD_INFRA_ID_MAX = 72;

function squadScopedInfraRowId(longPrefix: string, shortPrefix: string, parentId: string): string {
  const pid = parentId.trim();
  const direct = `${longPrefix}${pid}`;
  if (direct.length <= SQUAD_INFRA_ID_MAX) return direct;
  const hash = keccak256(stringToBytes(pid)).slice(2);
  return `${shortPrefix}-${hash}`;
}

/** Stable id for pacto-gov infra row per parent. */
export function pactoGovInfraId(parentId: string): string {
  return squadScopedInfraRowId('pacto-gov-', 'pg', parentId);
}

/** Stable treasury row id for the Safe deployed with Nave Pirata. */
export function pactoGovTreasuryEntryId(parentId: string): string {
  return squadScopedInfraRowId('pacto-gov-treasury-', 'pgt', parentId);
}

/** Stable id for squad sponsor infra row per parent. */
export function squadSponsorInfraId(parentId: string): string {
  return squadScopedInfraRowId('sponsor-', 'sp', parentId);
}

/** Stable id for squad-admin infra row per parent. */
export function squadAdminInfraId(parentId: string): string {
  return squadScopedInfraRowId('squad-admin-', 'sa', parentId);
}
