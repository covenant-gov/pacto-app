import { invoke } from '@tauri-apps/api/core';
import { squadRpcUrlsForInvoke } from '../squad/squad-rpc-invoke';
import { afterGovWrite } from './api-internal';
import type { SquadInfraDto } from './api-squad-infra';

export interface SquadAdminExecutorRolesDto {
  address: string;
  fullPermission: boolean;
  paused: boolean;
  roles: { role: string; enabled: boolean }[];
}

export async function getSquadAdminExecutorRoles(params: {
  network: string;
  squadAdminProxy: string;
  executorAddress: string;
  parentId?: string | null;
}): Promise<SquadAdminExecutorRolesDto> {
  return (await invoke('get_squad_admin_executor_roles', {
    network: params.network,
    squadAdminProxy: params.squadAdminProxy.trim(),
    executorAddress: params.executorAddress.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadAdminExecutorRolesDto;
}

/** Wire payload for `governance_updated` when squad-admin infra is deployed. */
export function buildSquadAdminGovernanceAnnouncePayload(params: {
  parentId: string;
  squadAdminProxy: string;
  chain: string;
  providerPayload: string;
  entryId: string;
}): {
  parent_id: string;
  provider: 'squad_admin';
  canonical_ref: string;
  chain: string;
  entry_id: string;
  provider_payload: string;
} {
  return {
    parent_id: params.parentId,
    provider: 'squad_admin',
    canonical_ref: params.squadAdminProxy,
    chain: params.chain,
    entry_id: params.entryId,
    provider_payload: params.providerPayload,
  };
}

/** Mirrors `SquadAdminDeployResult` from Tauri (`serde(rename_all = "camelCase")`). */
export interface SquadAdminDeployResultDto {
  txHash: string;
  chain: string;
  chainId: number;
  squadAdminProxy: string;
  variant: string;
  owner?: string | null;
  captainHatId?: string | null;
  implementation: string;
  providerPayload: string;
  infraRowId: string;
}

/** Backend: `deploy_squad_admin_for_parent`. */
export async function deploySquadAdminForParent(params: {
  network: string;
  parentId: string;
  variant: 'ext_standalone' | 'captain_hat';
  owner?: string | null;
  captainHatId?: string | null;
}): Promise<SquadAdminDeployResultDto> {
  return (await invoke('deploy_squad_admin_for_parent', {
    network: params.network,
    parentId: params.parentId,
    variant: params.variant,
    owner: params.owner?.trim() ? params.owner.trim() : null,
    captainHatId: params.captainHatId?.trim() ? params.captainHatId.trim() : null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadAdminDeployResultDto;
}

/** Mirrors `SquadAdminWriteResult` from Tauri. */
export interface SquadAdminWriteResultDto {
  txHash: string;
  chain: string;
  chainId: number;
  squadAdminProxy: string;
}

export async function squadAdminCreateRole(params: {
  network: string;
  parentId: string;
  squadAdminProxy: string;
  roleLabel: string;
}): Promise<SquadAdminWriteResultDto> {
  return afterGovWrite(
    (await invoke('squad_admin_create_role', {
      network: params.network,
      parentId: params.parentId.trim(),
      squadAdminProxy: params.squadAdminProxy.trim(),
      roleLabel: params.roleLabel.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as SquadAdminWriteResultDto,
    { parentId: params.parentId, kind: 'hats', address: params.squadAdminProxy },
  );
}

export async function squadAdminEnableExecutor(params: {
  network: string;
  parentId: string;
  squadAdminProxy: string;
  executorAddress: string;
  roleLabel: string;
}): Promise<SquadAdminWriteResultDto> {
  return afterGovWrite(
    (await invoke('squad_admin_enable_executor', {
      network: params.network,
      parentId: params.parentId.trim(),
      squadAdminProxy: params.squadAdminProxy.trim(),
      executorAddress: params.executorAddress.trim(),
      roleLabel: params.roleLabel.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as SquadAdminWriteResultDto,
    { parentId: params.parentId, kind: 'hats', address: params.executorAddress },
  );
}

export async function squadAdminEnableFullPermission(params: {
  network: string;
  parentId: string;
  squadAdminProxy: string;
  executorAddress: string;
  enable: boolean;
}): Promise<SquadAdminWriteResultDto> {
  return afterGovWrite(
    (await invoke('squad_admin_enable_full_permission', {
      network: params.network,
      parentId: params.parentId.trim(),
      squadAdminProxy: params.squadAdminProxy.trim(),
      executorAddress: params.executorAddress.trim(),
      enable: params.enable,
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as SquadAdminWriteResultDto,
    { parentId: params.parentId, kind: 'hats', address: params.executorAddress },
  );
}

export interface CapabilityFlagDto {
  allowed: boolean;
  reason: string;
}

export interface SquadCapabilitiesDto {
  parentId: string;
  rosterAddress: string;
  wearsCaptain: boolean;
  wearsCrew: boolean;
  captainIsSafe: boolean;
  squadAdminFull: boolean;
  squadAdminPaused: boolean;
  roleLabel: string;
  capabilities: Record<string, CapabilityFlagDto>;
}

/** Backend: `get_squad_capabilities`. */
export async function getSquadCapabilities(
  parentId: string,
  network?: string | null,
  opts?: { wargame?: boolean },
): Promise<SquadCapabilitiesDto> {
  return (await invoke('get_squad_capabilities', {
    parentId: parentId.trim(),
    rpcUrls: squadRpcUrlsForInvoke(parentId, network),
    wargame: opts?.wargame === true,
  })) as SquadCapabilitiesDto;
}

/** Squad-admin infra row for a parent (standalone deploy), if any. */
export function squadAdminInfraRow(rows: SquadInfraDto[] | undefined): SquadInfraDto | null {
  return rows?.find((r) => r.infraType === 'squad_admin') ?? null;
}
