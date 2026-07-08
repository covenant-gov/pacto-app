import type { SquadAdminExecutorRolesDto } from './api';

/** Parsed `provider_payload` v1 from a pacto-gov infra row. */
export interface PactoGovProviderPayloadV1 {
  v?: number;
  parentId?: string;
  txHash?: string;
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

/** Ensure deploy tx hash is present in v1 provider_payload JSON (announce + infra parity). */
export function withPactoGovProviderPayloadTxHash(
  raw: string,
  txHash: string | null | undefined,
): string {
  const hash = txHash?.trim();
  if (!hash) return raw;
  try {
    const parsed = JSON.parse(raw) as PactoGovProviderPayloadV1 & { tx_hash?: string };
    if (!parsed || typeof parsed !== 'object') return raw;
    if (parsed.txHash?.trim() === hash || parsed.tx_hash?.trim() === hash) return raw;
    return JSON.stringify({ ...parsed, txHash: hash });
  } catch {
    return raw;
  }
}

export type PactoGovDeployAnnounceRow =
  | { kind: 'address'; label: string; address: string }
  | { kind: 'hat'; label: string; hatId: string };

function isEvmAddress(addr: string | undefined): addr is string {
  return !!addr?.trim() && /^0x[a-fA-F0-9]{40}$/.test(addr.trim());
}

/** Labeled contract rows for Pacto Gov deploy announcement cards. */
export function pactoGovDeployAnnounceRows(params: {
  providerPayload: string | null | undefined;
  topHatId: string;
}): PactoGovDeployAnnounceRow[] {
  const parsed = parsePactoGovProviderPayload(params.providerPayload);
  const rows: PactoGovDeployAnnounceRow[] = [];
  const push = (label: string, addr: string | undefined) => {
    if (isEvmAddress(addr)) rows.push({ kind: 'address', label, address: addr.trim() });
  };
  push('Treasury Safe', parsed?.safe);
  push('Squad Admin', parsed?.squadAdminProxy);
  push('Quartermaster', parsed?.quartermaster);
  push('Mutiny module', parsed?.mutinyModule);
  push('Treasury Authority', parsed?.treasuryAuthority);
  const hatId = params.topHatId?.trim();
  if (hatId) rows.push({ kind: 'hat', label: 'Top hat', hatId });
  return rows;
}

export function txHashFromPactoGovProviderPayload(raw: string | null | undefined): string {
  if (!raw?.trim()) return '';
  try {
    const parsed = JSON.parse(raw) as { txHash?: unknown; tx_hash?: unknown };
    const h = parsed.txHash ?? parsed.tx_hash;
    return typeof h === 'string' ? h.trim() : '';
  } catch {
    return '';
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
