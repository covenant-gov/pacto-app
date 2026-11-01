import type { ParentGovernanceDto } from '$lib/governance/api';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

/** Mirrors governance hydration / SQLite row shape for the Permissions tab. */
export type DashboardPermissionsGovPhase =
  | 'loading'
  | 'mls_only'
  | 'pacto_gov'
  | 'treasury_safe_only'
  | 'other_provider';

export interface PermissionsCatalogRow {
  id: string;
  title: string;
  summary: string;
}

/** Conceptual rows aligned with SquadAdminBase: bytes32 roles, FULL/PAUSE executor scopes, captain gate. */
export function pactoGovPermissionsCatalog(): PermissionsCatalogRow[] {
  const tFn = get(t);
  return [
    {
      id: 'bytes32_roles',
      title: tFn('governance.dashboard.permissions.catalog.bytes32Roles.title'),
      summary: tFn('governance.dashboard.permissions.catalog.bytes32Roles.summary'),
    },
    {
      id: 'full_pause',
      title: tFn('governance.dashboard.permissions.catalog.fullPause.title'),
      summary: tFn('governance.dashboard.permissions.catalog.fullPause.summary'),
    },
    {
      id: 'captain_gate',
      title: tFn('governance.dashboard.permissions.catalog.captainGate.title'),
      summary: tFn('governance.dashboard.permissions.catalog.captainGate.summary'),
    },
  ];
}

/** Safe-multisig anchoring without SquadAdmin deployment yet. */
export function treasurySafePermissionsCatalog(): PermissionsCatalogRow[] {
  const tFn = get(t);
  return [
    {
      id: 'safe_threshold',
      title: tFn('governance.dashboard.permissions.catalog.safeThreshold.title'),
      summary: tFn('governance.dashboard.permissions.catalog.safeThreshold.summary'),
    },
    {
      id: 'squad_admin_inactive',
      title: tFn('governance.dashboard.permissions.catalog.squadAdminInactive.title'),
      summary: tFn('governance.dashboard.permissions.catalog.squadAdminInactive.summary'),
    },
  ];
}

export interface DashboardPermissionsContext {
  phase: DashboardPermissionsGovPhase;
  leadNote: string;
  catalogRows: PermissionsCatalogRow[];
  pactoGovRevision?: string;
  /** When true, show muted executor-mapping placeholder under the catalog. */
  showExecutorMappingPlaceholder: boolean;
}

export function resolveDashboardPermissionsContext(
  governanceConfig: ParentGovernanceDto | null | undefined,
): DashboardPermissionsContext {
  const tFn = get(t);
  if (governanceConfig === undefined) {
    return {
      phase: 'loading',
      leadNote: '',
      catalogRows: [],
      showExecutorMappingPlaceholder: false,
    };
  }
  if (!governanceConfig) {
    return {
      phase: 'mls_only',
      leadNote: tFn('governance.dashboard.permissions.lead.mlsOnly'),
      catalogRows: [],
      showExecutorMappingPlaceholder: false,
    };
  }
  if (governanceConfig.provider === 'pacto_gov') {
    const rev = governanceConfig.pactoGovRevision?.trim();
    return {
      phase: 'pacto_gov',
      leadNote: tFn('governance.dashboard.permissions.lead.pactoGov'),
      catalogRows: pactoGovPermissionsCatalog(),
      ...(rev ? { pactoGovRevision: rev } : {}),
      showExecutorMappingPlaceholder: false,
    };
  }
  if (governanceConfig.provider === 'gnosis_safe') {
    return {
      phase: 'treasury_safe_only',
      leadNote: tFn('governance.dashboard.permissions.lead.treasurySafe'),
      catalogRows: treasurySafePermissionsCatalog(),
      showExecutorMappingPlaceholder: false,
    };
  }
  return {
    phase: 'other_provider',
    leadNote: tFn('governance.dashboard.permissions.lead.otherProvider'),
    catalogRows: [],
    showExecutorMappingPlaceholder: false,
  };
}
