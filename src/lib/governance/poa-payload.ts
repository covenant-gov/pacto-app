import type { SquadInfraDto } from './api';

/**
 * Parsed `provider_payload` v1 from a POA (POP protocol) governance infra row.
 *
 * POA orgs are deployed by `OrgDeployer.deployFullOrg` and addressed by a native
 * `orgId` (bytes32). The connector records the org's module addresses so the
 * dashboard can link out / read on-chain state without re-querying the deployer.
 */
export interface PoaProviderPayloadV1 {
  v?: number;
  org_id?: string;
  executor?: string;
  hybrid_voting?: string;
  direct_democracy_voting?: string;
  participation_token?: string;
  task_manager?: string;
  payment_manager?: string;
  label?: string;
}

export function parsePoaProviderPayload(
  raw: string | null | undefined,
): PoaProviderPayloadV1 | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as PoaProviderPayloadV1;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function buildPoaProviderPayload(params: {
  orgId: string;
  executor?: string;
  hybridVoting?: string;
  directDemocracyVoting?: string;
  participationToken?: string;
  taskManager?: string;
  paymentManager?: string;
  label?: string;
}): string {
  return JSON.stringify({
    v: 1,
    org_id: params.orgId.trim(),
    ...(params.executor?.trim() ? { executor: params.executor.trim() } : {}),
    ...(params.hybridVoting?.trim() ? { hybrid_voting: params.hybridVoting.trim() } : {}),
    ...(params.directDemocracyVoting?.trim()
      ? { direct_democracy_voting: params.directDemocracyVoting.trim() }
      : {}),
    ...(params.participationToken?.trim()
      ? { participation_token: params.participationToken.trim() }
      : {}),
    ...(params.taskManager?.trim() ? { task_manager: params.taskManager.trim() } : {}),
    ...(params.paymentManager?.trim() ? { payment_manager: params.paymentManager.trim() } : {}),
    ...(params.label?.trim() ? { label: params.label.trim() } : {}),
  });
}

export function poaInfraRows(rows: SquadInfraDto[] | undefined): SquadInfraDto[] {
  return rows?.filter((r) => r.infraType === 'poa') ?? [];
}

/** POA infra row for a parent, if any. */
export function poaInfraRow(rows: SquadInfraDto[] | undefined): SquadInfraDto | null {
  return rows?.find((r) => r.infraType === 'poa') ?? null;
}

export function hasPoaInfra(rows: SquadInfraDto[] | undefined): boolean {
  return poaInfraRow(rows) != null;
}
