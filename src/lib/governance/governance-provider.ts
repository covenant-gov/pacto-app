import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
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
  const tFn = get(t);

  const modules: GovernanceModuleDescriptor[] = [];
  if (payload.treasuryAuthority?.trim()) {
    modules.push({
      id: 'treasury_authority',
      label: tFn('governance.title.treasuryAuthority'),
      address: payload.treasuryAuthority.trim(),
      summary:
        open > 0
          ? tFn('governance.governance.openProposals', { values: { count: open } })
          : tFn('governance.module.treasuryAuthority.idle'),
    });
  }
  if (payload.mutinyModule?.trim()) {
    modules.push({
      id: 'mutiny',
      label: tFn('governance.title.mutiny'),
      address: payload.mutinyModule.trim(),
      summary: mutinyActive
        ? tFn('governance.module.mutiny.active')
        : tFn('governance.module.mutiny.idle'),
    });
  }
  if (payload.quartermaster?.trim()) {
    modules.push({
      id: 'quartermaster',
      label: tFn('governance.title.quartermaster'),
      address: payload.quartermaster.trim(),
      summary: mutinyMode
        ? tFn('governance.module.quartermaster.locked')
        : tFn('governance.module.quartermaster.idle'),
    });
  }
  if (payload.squadAdminProxy?.trim()) {
    modules.push({
      id: 'squad_admin',
      label: tFn('governance.hats.info.name.squadAdmin'),
      address: payload.squadAdminProxy.trim(),
      summary: tFn('governance.module.squadAdmin.summary'),
    });
  }
  if (payload.safe?.trim()) {
    modules.push({
      id: 'safe',
      label: tFn('governance.infra.treasurySafe'),
      address: payload.safe.trim(),
      summary: tFn('governance.module.safe.summary'),
    });
  }
  return modules;
}
