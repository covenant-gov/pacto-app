import { invoke } from '@tauri-apps/api/core';
import { squadRpcUrlsForInvoke } from '../squad/squad-rpc-invoke';
import { DEFAULT_SQUAD_PRACTICE_NETWORK } from '../squad/squad-network';
import type { SquadParamsInput } from './squad-params';
import { squadParamsToInvoke } from './squad-params';
import type { SquadInfraDto } from './api-squad-infra';
import type { SquadSponsorDeploySignerWallet } from './api-sponsor';

/** Mirrors `NavePirataDeployResult` from Tauri (`serde(rename_all = "camelCase")`). */
export interface NavePirataDeployResultDto {
  txHash: string;
  chain: string;
  chainId: number;
  topHatId: string;
  safeAddress: string;
  quartermaster: string;
  mutinyModule: string;
  treasuryAuthority: string;
  squadAdminProxy: string;
  providerPayload: string;
  /** Stable `squad_infra` row id persisted by the backend on deploy. */
  infraRowId: string;
}

/** Mirrors `WarGameDeployResult` from Tauri (`serde(rename_all = "camelCase")`). */
export interface WarGameDeployResultDto {
  txHash: string;
  chain: string;
  chainId: number;
  topHatId: string;
  safeAddress: string;
  quartermaster: string;
  mutinyModule: string;
  treasuryAuthority: string;
  squadAdminProxy: string;
  round: string;
  gameSquadId: string;
  sponsorAddress: string;
  retiredSponsor: string | null;
  providerPayload: string;
  infraRowId: string;
}

/** Backend: `deploy_nave_pirata_for_parent`. */
export async function deployNavePirataForParent(params: {
  network: string;
  parentId: string;
  captain: string;
  metadataUri?: string | null;
  saltNonce?: string | null;
  signerWallet?: SquadSponsorDeploySignerWallet;
  /** When UI parent id differs from #announcements MLS id, roster rows may live under this key. */
  altParentId?: string | null;
  squadParams?: SquadParamsInput | null;
}): Promise<NavePirataDeployResultDto> {
  return (await invoke('deploy_nave_pirata_for_parent', {
    network: params.network,
    parentId: params.parentId,
    captain: params.captain,
    metadataUri: params.metadataUri?.trim() ?? '',
    saltNonce: params.saltNonce?.trim() ? params.saltNonce.trim() : null,
    signerWallet: params.signerWallet ?? 'squad',
    altParentId: params.altParentId?.trim() ? params.altParentId.trim() : null,
    squadParams: params.squadParams ? squadParamsToInvoke(params.squadParams) : null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as NavePirataDeployResultDto;
}

/** Backend: `deploy_war_game_for_parent`. Always Sepolia. */
export async function deployWarGameForParent(params: {
  parentId: string;
  captain: string;
  network?: string | null;
  metadataUri?: string | null;
  saltNonce?: string | null;
  signerWallet?: SquadSponsorDeploySignerWallet;
  altParentId?: string | null;
  squadParams?: SquadParamsInput | null;
  initialDepositWei?: string | null;
}): Promise<WarGameDeployResultDto> {
  const network = params.network?.trim() || DEFAULT_SQUAD_PRACTICE_NETWORK;
  return (await invoke('deploy_war_game_for_parent', {
    network,
    parentId: params.parentId,
    captain: params.captain,
    metadataUri: params.metadataUri?.trim() ?? '',
    saltNonce: params.saltNonce?.trim() ? params.saltNonce.trim() : null,
    signerWallet: params.signerWallet ?? 'default',
    altParentId: params.altParentId?.trim() ? params.altParentId.trim() : null,
    squadParams: params.squadParams ? squadParamsToInvoke(params.squadParams) : null,
    initialDepositWei: params.initialDepositWei?.trim() ? params.initialDepositWei.trim() : null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, network),
  })) as WarGameDeployResultDto;
}

/** Mirrors `NavePirataDeploymentDto` from Tauri (`serde(rename_all = "camelCase")`). */
export interface NavePirataDeploymentDto {
  chain: string;
  chainId: number;
  topHatId: string;
  safe: string;
  quartermaster: string;
  mutinyModule: string;
  treasuryAuthority: string;
  squadAdminProxy: string;
  captainHatId: string;
  crewHatId: string;
  squadAdminHatId: string;
  mutinyRoleHatId: string;
  quartermasterRoleHatId: string;
  treasuryAuthorityRoleHatId: string;
  deployedAt: number;
  deployer: string;
}

export async function getNavePirataDeployment(params: {
  network: string;
  topHatId: string;
  parentId?: string | null;
}): Promise<NavePirataDeploymentDto> {
  return (await invoke('get_nave_pirata_deployment', {
    network: params.network,
    topHatId: params.topHatId.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as NavePirataDeploymentDto;
}

/** Backend: `get_war_game_deployment`. Same DTO as Nave Pirata; WarGameRegistry only. */
export async function getWarGameDeployment(params: {
  network: string;
  topHatId: string;
  parentId?: string | null;
}): Promise<NavePirataDeploymentDto> {
  return (await invoke('get_war_game_deployment', {
    network: params.network,
    topHatId: params.topHatId.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as NavePirataDeploymentDto;
}

/** War-game stack row for a parent, if any. */
export function pactoGovWargameInfraRow(rows: SquadInfraDto[] | undefined): SquadInfraDto | null {
  return rows?.find((r) => r.infraType === 'pacto_gov_wargame') ?? null;
}
