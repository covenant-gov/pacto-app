import type { SquadAdminExecutorRolesDto } from './api';

/** Parsed `provider_payload` v1 from a pacto-gov infra row. */
export interface PactoGovProviderPayloadV1 {
  v?: number;
  parentId?: string;
  safe?: string;
  quartermaster?: string;
  mutinyModule?: string;
  treasuryAuthority?: string;
  squadAdminProxy?: string;
}

export function parsePactoGovProviderPayload(
  raw: string | null | undefined,
): PactoGovProviderPayloadV1 | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as PactoGovProviderPayloadV1;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Hat id + label pairs for `get_member_hat_wearers` when registry deployment is loaded. */
export function hatChecksFromNaveDeployment(d: {
  captainHatId: string;
  crewHatId: string;
  squadAdminHatId: string;
  mutinyRoleHatId: string;
  quartermasterRoleHatId: string;
  treasuryAuthorityRoleHatId: string;
}): { hatId: string; label: string }[] {
  return [
    { hatId: d.captainHatId, label: 'Captain' },
    { hatId: d.crewHatId, label: 'Crew' },
    { hatId: d.squadAdminHatId, label: 'Squad Admin' },
    { hatId: d.mutinyRoleHatId, label: 'Mutiny Role' },
    { hatId: d.quartermasterRoleHatId, label: 'Quartermaster Role' },
    { hatId: d.treasuryAuthorityRoleHatId, label: 'Treasury Authority Role' },
  ];
}

/** Compact label for Settings **Roles** column (SquadAdmin executor scopes). */
export function formatSquadAdminExecutorRoles(d: SquadAdminExecutorRolesDto): string {
  if (d.fullPermission) {
    return d.paused ? 'Full (paused)' : 'Full';
  }
  const enabled = d.roles.filter((r) => r.enabled).map((r) => r.role);
  if (enabled.length === 0) {
    return d.paused ? 'Paused' : '—';
  }
  const label = enabled.join(', ');
  return d.paused ? `${label} (paused)` : label;
}

export function treasuryProposalStatusLabel(status: string): string {
  switch (status) {
    case 'executed':
      return 'Executed';
    case 'captain_vetoed':
      return 'Captain vetoed';
    case 'expired':
      return 'Expired';
    case 'active_passed_crew':
      return 'Crew passed — awaiting captain / execute';
    case 'active':
      return 'Active';
    default:
      return status;
  }
}
