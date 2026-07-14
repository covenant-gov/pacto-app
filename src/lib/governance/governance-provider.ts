import type { SquadInfraDto } from './api';
import { pactoGovInfraRow } from './api';
import { resolveAbiRefFromInfraPayload } from '../evm/abi-loader';
import { parsePactoGovProviderPayload, type PactoGovProviderPayloadV1 } from './pacto-gov-payload';

/** Governance tab provider — `abi_modules` is a reserved doorway, not implemented yet. */
export type GovernanceProviderId = 'pacto_gov' | 'abi_modules' | 'none';

export function resolveGovernanceProvider(
  squadInfraRows: SquadInfraDto[] | null | undefined,
): GovernanceProviderId {
  const pacto = pactoGovInfraRow(squadInfraRows ?? undefined);
  if (pacto?.canonicalRef?.trim()) {
    const payload = parsePactoGovProviderPayload(pacto.providerPayload);
    if (payload?.treasuryAuthority?.trim()) return 'pacto_gov';
  }

  for (const row of squadInfraRows ?? []) {
    if (!row?.providerPayload) continue;
    try {
      const parsed = JSON.parse(row.providerPayload) as unknown;
      if (resolveAbiRefFromInfraPayload(parsed)) return 'abi_modules';
    } catch {
      /* ignore */
    }
  }

  return 'none';
}

export type PactoGovModuleId =
  | 'treasury_authority'
  | 'mutiny'
  | 'quartermaster'
  | 'squad_admin'
  | 'safe';

export interface GovernanceModuleDescriptor {
  id: PactoGovModuleId;
  label: string;
  address: string;
  /** Short face copy for the module card. */
  summary: string;
}

/** Clickable Pacto Gov modules for the Governance shell. */
export function pactoGovModuleDescriptors(
  payload: PactoGovProviderPayloadV1 | null | undefined,
  opts?: { openProposalCount?: number; mutinyActive?: boolean; mutinyModeQm?: boolean },
): GovernanceModuleDescriptor[] {
  if (!payload) return [];
  const open = opts?.openProposalCount ?? 0;
  const mutinyActive = opts?.mutinyActive ?? false;
  const mutinyMode = opts?.mutinyModeQm ?? false;

  const modules: GovernanceModuleDescriptor[] = [];
  if (payload.treasuryAuthority?.trim()) {
    modules.push({
      id: 'treasury_authority',
      label: 'Treasury Authority',
      address: payload.treasuryAuthority.trim(),
      summary: open > 0 ? `${open} open proposal${open === 1 ? '' : 's'}` : 'Propose · vote · execute',
    });
  }
  if (payload.mutinyModule?.trim()) {
    modules.push({
      id: 'mutiny',
      label: 'Mutiny',
      address: payload.mutinyModule.trim(),
      summary: mutinyActive ? 'Mutiny active' : 'Replace or resign captain',
    });
  }
  if (payload.quartermaster?.trim()) {
    modules.push({
      id: 'quartermaster',
      label: 'Quartermaster',
      address: payload.quartermaster.trim(),
      summary: mutinyMode ? 'Mutiny mode — roster locked' : 'Add / remove crew (timelock)',
    });
  }
  if (payload.squadAdminProxy?.trim()) {
    modules.push({
      id: 'squad_admin',
      label: 'Squad Admin',
      address: payload.squadAdminProxy.trim(),
      summary: 'Executor roles — manage in Crew',
    });
  }
  if (payload.safe?.trim()) {
    modules.push({
      id: 'safe',
      label: 'Treasury Safe',
      address: payload.safe.trim(),
      summary: 'Shared vault (Zodiac avatar)',
    });
  }
  return modules;
}
