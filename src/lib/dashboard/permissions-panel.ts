import type { ParentGovernanceDto } from '$lib/governance/api';

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
  return [
    {
      id: 'bytes32_roles',
      title: 'On-chain role identifiers',
      summary:
        'Logical roles are fixed bytes32 keys on SquadAdmin; hat holders, allowlists, and roster tooling bind members to those slots.',
    },
    {
      id: 'full_pause',
      title: 'FULL versus PAUSE executor scopes',
      summary:
        'Executors may receive full operational authority on a module or a narrower pause-bounded scope, depending on how the squad wired allowances.',
    },
    {
      id: 'captain_gate',
      title: 'Captain-gated admin mutations',
      summary:
        'Structural changes to roles, executors, and sensitive parameters route through the captain-controlled admin paths enforced by SquadAdminBase.',
    },
  ];
}

/** Safe-multisig anchoring without SquadAdmin deployment yet. */
export function treasurySafePermissionsCatalog(): PermissionsCatalogRow[] {
  return [
    {
      id: 'safe_threshold',
      title: 'Safe multisig authority',
      summary:
        'Treasury actions on linked Safes follow the wallet-defined signing threshold and owner set configured on-chain.',
    },
    {
      id: 'squad_admin_inactive',
      title: 'SquadAdmin role graph',
      summary:
        'bytes32 role slots, executor mappings, and captain-gated upgrades stay inactive until Pacto Gov is deployed for this parent.',
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
      leadNote:
        'On-chain role catalog and executor mappings appear after you deploy Pacto Gov from Deploy. Until then, use this roster for membership and shared EVM addresses.',
      catalogRows: [],
      showExecutorMappingPlaceholder: false,
    };
  }
  if (governanceConfig.provider === 'pacto_gov') {
    const rev = governanceConfig.pactoGovRevision?.trim();
    return {
      phase: 'pacto_gov',
      leadNote:
        'Role identifiers, executor scopes, and captain-gated admin actions follow SquadAdminBase. Member Hats and executor Roles load from chain on this tab.',
      catalogRows: pactoGovPermissionsCatalog(),
      ...(rev ? { pactoGovRevision: rev } : {}),
      showExecutorMappingPlaceholder: false,
    };
  }
  if (governanceConfig.provider === 'gnosis_safe') {
    return {
      phase: 'treasury_safe_only',
      leadNote:
        'This parent anchors governance on a Safe multisig. SquadAdmin-style role rows remain placeholders until Pacto Gov is deployed.',
      catalogRows: treasurySafePermissionsCatalog(),
      showExecutorMappingPlaceholder: false,
    };
  }
  return {
    phase: 'other_provider',
    leadNote: 'Permissions details for this governance provider are not wired in the UI yet.',
    catalogRows: [],
    showExecutorMappingPlaceholder: false,
  };
}
