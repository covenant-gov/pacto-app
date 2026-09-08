import { invoke } from '@tauri-apps/api/core';

/** Mirrors `GlobalSponsoredFeeUsageRow` from Tauri (`serde(rename_all = "camelCase")`). */
export interface GlobalSponsoredFeeUsageDto {
  id: string;
  lane: string;
  parentId: string | null;
  chain: string;
  chainId: number;
  actorNpub: string;
  actorEvm: string;
  amountWei: string;
  selector: string;
  action: string;
  target: string;
  userOpHash: string;
  txHash: string;
  createdAtMs: number;
}

/** Backend: `list_global_sponsored_fee_usage` (current account; newest first; default cap 50). */
export async function listGlobalSponsoredFeeUsage(params?: {
  limit?: number;
}): Promise<GlobalSponsoredFeeUsageDto[]> {
  return (await invoke('list_global_sponsored_fee_usage', {
    limit: params?.limit,
  })) as GlobalSponsoredFeeUsageDto[];
}
