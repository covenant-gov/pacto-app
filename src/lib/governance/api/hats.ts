import { invoke } from '@tauri-apps/api/core';
import { squadRpcUrlsForInvoke } from '../../squad/squad-rpc-invoke';

/** Mirrors `HatTreeNodeDto` from Tauri (`serde(rename_all = "camelCase")`). */
export interface HatTreeNodeDto {
  hatId: string;
  details: string;
  maxSupply: number;
  supply: number;
  active: boolean;
  children: HatTreeNodeDto[];
}

export async function getHatsTree(params: {
  network: string;
  topHatId: string;
  maxDepth?: number | null;
  maxNodes?: number | null;
  parentId?: string | null;
}): Promise<HatTreeNodeDto> {
  return (await invoke('get_hats_tree', {
    network: params.network,
    topHatId: params.topHatId.trim(),
    maxDepth: params.maxDepth ?? null,
    maxNodes: params.maxNodes ?? null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as HatTreeNodeDto;
}

export interface MemberHatLabelDto {
  hatId: string;
  label: string;
}

export interface MemberHatAssignmentDto {
  address: string;
  hats: MemberHatLabelDto[];
}

export async function getMemberHatWearers(params: {
  network: string;
  hatsContract?: string | null;
  memberAddresses: string[];
  hatChecks: { hatId: string; label: string }[];
  parentId?: string | null;
}): Promise<MemberHatAssignmentDto[]> {
  return (await invoke('get_member_hat_wearers', {
    network: params.network,
    hatsContract: params.hatsContract?.trim() ? params.hatsContract.trim() : null,
    memberAddresses: params.memberAddresses,
    hatChecks: params.hatChecks,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as MemberHatAssignmentDto[];
}

export interface HatWearersDto {
  hatId: string;
  addresses: string[];
}

export async function getHatWearersForIds(params: {
  network: string;
  hatIds: string[];
  fromTxHash?: string | null;
  hatsContract?: string | null;
  parentId?: string | null;
}): Promise<HatWearersDto[]> {
  return (await invoke('get_hat_wearers_for_ids', {
    network: params.network,
    hatIds: params.hatIds,
    fromTxHash: params.fromTxHash?.trim() ? params.fromTxHash.trim() : null,
    hatsContract: params.hatsContract?.trim() ? params.hatsContract.trim() : null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as HatWearersDto[];
}
